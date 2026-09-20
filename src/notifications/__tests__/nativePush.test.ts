import { Platform } from 'react-native';
import { createElement } from 'react';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { mobileSession } from '../../auth/mobileSession';
import { act, render } from '@testing-library/react-native';
import { NativePushSettings } from '../NativePushSettings';
import { disableNativePush, enableNativePush, nativePushConfiguration, rotateNativePush, refreshNativePush, foregroundMeetingBehavior } from '../nativePush';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: {
  android: { package: 'com.workcube.meeting' }, extra: { nativePush: { enabled: true, environment: 'TEST', orgId: 'org' } },
  ios: { bundleIdentifier: 'com.workcube.meeting' },
} } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111',
  CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async () => 'a'.repeat(64) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('expo-notifications', () => ({ AndroidImportance: { DEFAULT: 3 }, setNotificationChannelAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(), getPermissionsAsync: jest.fn(), getDevicePushTokenAsync: jest.fn(),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })) }));
jest.mock('../../auth/mobileSession', () => ({ mobileSession: { valid: jest.fn(), snapshot: jest.fn() } }));
const fetchMock = jest.fn();
let stored: string | null;
const receipt = { installationId: '11111111-1111-4111-8111-111111111111', applicationId: 'com.workcube.meeting',
  provider: 'FCM', environment: 'TEST', owner: 'a'.repeat(64), enabled: true };
const content: Notifications.NotificationContent = { title: 'Toplantı güncellemesi', body: 'Toplantı sonucunu uygulamada görüntüleyebilirsiniz.',
  subtitle: null, categoryIdentifier: null, sound: null,
  data: { eventType: 'meeting.summary.ready', meetingId: '06dbefb9-242b-4b4d-b4d5-d444e66b6dfe' },
};
beforeEach(() => {
  delete Constants.expoConfig!.extra!.nativePush.platforms;
  jest.clearAllMocks(); Platform.OS = 'android'; global.fetch = fetchMock;
  stored = null;
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async () => stored);
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (_key, value) => { stored = value; });
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async () => { stored = null; });
  const session = { jwt: `header.${btoa(JSON.stringify({
    iss: 'https://testai.acik.com/realms/platform-test', sub: 'user',
  }))}.signature`, expiresAt: Date.now() + 600000 };
  (mobileSession.valid as jest.Mock).mockResolvedValue(session);
  (mobileSession.snapshot as jest.Mock).mockReturnValue(session);
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Notifications.getDevicePushTokenAsync as jest.Mock).mockImplementation(async () => ({ type: 'android', data: 'device-token' }));
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'registered', registrationId: '22222222-2222-4222-8222-222222222222' }) });
});
afterEach(() => { jest.useRealTimers(); });
it('Android-only TEST configuration never activates unconfigured APNs', () => {
  Platform.OS = 'ios';
  expect(nativePushConfiguration()?.provider).toBe('APNS');
  Platform.OS = 'android';
  Constants.expoConfig!.extra!.nativePush.platforms = ['android'];
  expect(nativePushConfiguration()?.provider).toBe('FCM');
  Platform.OS = 'ios';
  expect(nativePushConfiguration()).toBeNull();
});
it('permission denial never requests or registers a device token', async () => {
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  await expect(enableNativePush()).rejects.toThrow('izin');
  expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});
it('registers the native token with authenticated owner and stores no token', async () => {
  await enableNativePush();
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/native-push/registrations'), expect.objectContaining({
    method: 'POST', headers: expect.objectContaining({ 'X-Subscriber-Id': 'user', 'X-Org-Id': 'org' }),
  }));
  expect(JSON.stringify((SecureStore.setItemAsync as jest.Mock).mock.calls)).not.toContain('device-token');
});
it('logout while permission dialog is open cancels the delayed enrollment', async () => {
  let grant!: (value: { granted: boolean }) => void;
  (Notifications.requestPermissionsAsync as jest.Mock).mockImplementation(() => new Promise(resolve => { grant = resolve; }));
  const pending = enableNativePush();
  while (!grant) await Promise.resolve();
  await disableNativePush(); grant({ granted: true });
  await expect(pending).rejects.toThrow('Hesap değişti');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('consumes one native token event once without recursively requesting tokens', async () => {
  const screen = render(createElement(NativePushSettings, { disabled: false }));
  await act(async () => {}); // Initial refresh has no enrollment.
  stored = JSON.stringify(receipt);
  const listener = jest.mocked(Notifications.addPushTokenListener).mock.calls.at(-1)![0];
  const device = { type: 'android', data: 'rotated-token' } as const;
  let requests = 0;
  jest.mocked(Notifications.getDevicePushTokenAsync).mockImplementation(async () => {
    // Match Expo's documented getter -> native listener behavior, bounded so the
    // old source fails deterministically instead of hanging the test process.
    if (++requests > 3) throw new Error('Recursive token request');
    listener(device);
    return device;
  });
  await act(async () => { listener(device); });
  expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).token).toBe('rotated-token');
  screen.unmount();
});

it.each(['applicationId', 'provider', 'environment', 'owner'] as const)('ignores token events for another receipt %s', async field => {
  const other = { applicationId: 'com.other.app', provider: 'APNS', environment: 'PRODUCTION', owner: 'b'.repeat(64) };
  stored = JSON.stringify({ ...receipt, [field]: other[field] });
  await rotateNativePush({ type: 'android', data: 'rotated-token' });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
});
it('rejects wrong-platform token events and refreshes the foreground through the getter', async () => {
  stored = JSON.stringify(receipt);
  await rotateNativePush({ type: 'ios', data: 'wrong-platform-token' });
  expect(fetchMock).not.toHaveBeenCalled();
  await refreshNativePush();
  expect(Notifications.getDevicePushTokenAsync).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it.each([true, false])('ignores stale permission result %s after logout and re-enrollment', async granted => {
  stored = JSON.stringify(receipt);
  let permission!: (value: { granted: boolean }) => void;
  jest.mocked(Notifications.getPermissionsAsync).mockImplementationOnce(() => new Promise(resolve => { permission = resolve as typeof permission; }));
  const rotation = rotateNativePush({ type: 'android', data: 'stale-token' });
  while (!permission) await Promise.resolve();
  await disableNativePush();
  await enableNativePush();
  fetchMock.mockClear();
  permission({ granted });
  await rotation;
  expect(fetchMock).not.toHaveBeenCalled();
  expect(JSON.parse(stored!).enabled).toBe(true);
});
it('permission revocation removes the registration without requesting another token', async () => {
  stored = JSON.stringify(receipt);
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false } as Notifications.NotificationPermissionsStatus);
  await refreshNativePush();
  expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'DELETE' }));
  expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
  expect(stored).toBeNull();
});

it('shows only a static meeting update in the foreground without any network or token request', async () => {
  stored = JSON.stringify(receipt);
  expect(await foregroundMeetingBehavior(content)).toEqual({ shouldShowBanner: true, shouldShowList: true,
    shouldPlaySound: false, shouldSetBadge: false });
  expect(mobileSession.valid).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
});
it.each([
  { ...content, data: { ...content.data, eventType: 'other' } },
  { ...content, title: 'Transcript or personal title' },
  { ...content, body: 'Private transcript' },
  { ...content, subtitle: 'Meeting name' },
  { ...content, data: { ...content.data, meetingId: '../other' } },
])('suppresses unknown/local notifications and non-static content: %j', async value => {
  stored = JSON.stringify(receipt);
  expect((await foregroundMeetingBehavior(value)).shouldShowBanner).toBe(false);
  expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
});
it.each([
  { ...receipt, enabled: false }, { ...receipt, owner: 'b'.repeat(64) }, { ...receipt, provider: 'APNS' },
])('suppresses a disabled or unrelated enrollment: %j', async value => {
  stored = JSON.stringify(value);
  expect((await foregroundMeetingBehavior(content)).shouldShowBanner).toBe(false);
});
it('does not restore a missing or expired foreground session', async () => {
  jest.mocked(mobileSession.snapshot).mockReturnValue(null);
  expect((await foregroundMeetingBehavior(content)).shouldShowBanner).toBe(false);
  expect(mobileSession.valid).not.toHaveBeenCalled();
  expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
});
it('suppresses presentation if logout occurs during local receipt loading', async () => {
  stored = JSON.stringify(receipt);
  let resolveRead!: (value: string) => void;
  jest.mocked(SecureStore.getItemAsync).mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
  const handling = foregroundMeetingBehavior(content);
  await disableNativePush();
  resolveRead(JSON.stringify(receipt));
  expect((await handling).shouldShowBanner).toBe(false);
});
it('fails closed on storage failure or a slow local handler without waiting for the OS deadline', async () => {
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('storage locked'));
  expect((await foregroundMeetingBehavior(content)).shouldShowBanner).toBe(false);
  jest.useFakeTimers();
  jest.mocked(SecureStore.getItemAsync).mockImplementationOnce(() => new Promise(() => {}));
  const pending = foregroundMeetingBehavior(content);
  await jest.advanceTimersByTimeAsync(1000);
  expect((await pending).shouldShowBanner).toBe(false);
  expect(mobileSession.valid).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});
