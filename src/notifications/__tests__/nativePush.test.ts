import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { mobileSession } from '../../auth/mobileSession';
import { disableNativePush, enableNativePush } from '../nativePush';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: {
  android: { package: 'com.workcube.meeting' }, extra: { nativePush: { enabled: true, environment: 'TEST', orgId: 'org' } },
} } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111',
  CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async () => 'a'.repeat(64) }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('expo-notifications', () => ({ AndroidImportance: { DEFAULT: 3 }, setNotificationChannelAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(), getDevicePushTokenAsync: jest.fn() }));
jest.mock('../../auth/mobileSession', () => ({ mobileSession: { valid: jest.fn() } }));
const fetchMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks(); Platform.OS = 'android'; global.fetch = fetchMock;
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  (mobileSession.valid as jest.Mock).mockResolvedValue({ jwt: `header.${btoa(JSON.stringify({
    iss: 'https://testai.acik.com/realms/platform-test', sub: 'user',
  }))}.signature` });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Notifications.getDevicePushTokenAsync as jest.Mock).mockResolvedValue({ data: 'device-token' });
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'registered', registrationId: '22222222-2222-4222-8222-222222222222' }) });
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
