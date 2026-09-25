import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { configureBackgroundCapture, supportsBackgroundCapture, startPcmCapture, listenBackgroundStop } from '../backgroundCapture';

jest.mock('../../../modules/workcube-pcm-background', () => ({
  __esModule: true,
  default: { isAvailable: jest.fn(() => true), lifecycleVersion: jest.fn(() => 1), start: jest.fn(), stop: jest.fn(),
    prepare: jest.fn(() => 'lease'), release: jest.fn(), startCapture: jest.fn(), captureState: jest.fn(), addListener: jest.fn() },
}));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn() }));
const native = jest.requireMock('../../../modules/workcube-pcm-background').default as {
  isAvailable: jest.Mock; start: jest.Mock; stop: jest.Mock; lifecycleVersion: jest.Mock;
  startCapture: jest.Mock; captureState: jest.Mock; addListener: jest.Mock;
  prepare: jest.Mock; release: jest.Mock;
};
const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks(); native.start.mockReset(); native.prepare.mockReturnValue('lease');
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true } as Notifications.NotificationPermissionsStatus);
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
});
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS }));

it('refuses invisible recording when notification permission is denied', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: false } as Notifications.NotificationPermissionsStatus);
  await expect(configureBackgroundCapture(true)).rejects.toThrow('bildirim');
  expect(native.start).not.toHaveBeenCalled(); expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});
it('enables native support only after permission succeeds', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: true } as Notifications.NotificationPermissionsStatus);
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({ granted: true } as Notifications.NotificationPermissionsStatus);
  await configureBackgroundCapture(true, { isStreaming: false });
  expect(native.start).toHaveBeenCalledTimes(1);
});

it('does not enable background capture on an older native APK', () => {
  native.lifecycleVersion.mockReturnValueOnce(0);
  expect(supportsBackgroundCapture()).toBe(false);
});

it('starts a background microphone through its service ownership guard', async () => {
  const stream = { start: jest.fn(), isStreaming: false };
  await configureBackgroundCapture(true, stream);
  await startPcmCapture(stream, true);
  expect(native.startCapture).toHaveBeenCalledWith('lease');
  expect(stream.start).not.toHaveBeenCalled();
  native.startCapture.mockRejectedValueOnce(new Error('Kayıt bildirimi kapandı'));
  await expect(startPcmCapture(stream, true)).rejects.toThrow('Kayıt bildirimi kapandı');
  expect(stream.start).not.toHaveBeenCalled();
});

it('ignores a queued notification stop from an older registration', () => {
  const onStop = jest.fn(); const stream = { isStreaming: true };
  native.captureState.mockReturnValue({ id: 'new', reason: '' });
  listenBackgroundStop(stream, onStop);
  const callback = native.addListener.mock.calls[0][1];
  callback({ id: 'old', streamId: 'stream', reason: 'notification-stop' });
  expect(onStop).not.toHaveBeenCalled();
  native.captureState.mockReturnValue({ id: 'new', reason: 'notification-stop' });
  callback({ id: 'new', streamId: 'stream', reason: 'notification-stop' });
  expect(onStop).toHaveBeenCalledWith('notification-stop');
});
it('turns the feature off without requesting permissions', async () => {
  await configureBackgroundCapture(false);
  expect(native.prepare).not.toHaveBeenCalled(); expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
});

it('releases the exact prepared registration on stop', async () => {
  const stream = { isStreaming: false };
  await configureBackgroundCapture(true, stream);
  await configureBackgroundCapture(false, stream);
  expect(native.release).toHaveBeenCalledWith('lease');
  await expect(startPcmCapture({ ...stream, start: jest.fn() }, true)).rejects.toThrow('Kayıt bildirimi kapandı');
});

it('does not prepare a service if permission returns after the recording was cancelled', async () => {
  let resolve!: (value: Notifications.NotificationPermissionsStatus) => void;
  let current = true;
  jest.mocked(Notifications.getPermissionsAsync).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const pending = configureBackgroundCapture(true, {}, () => current);
  current = false; resolve({ granted: true } as Notifications.NotificationPermissionsStatus);
  await pending;
  expect(native.prepare).not.toHaveBeenCalled(); expect(native.start).not.toHaveBeenCalled();
});

it('a late preparation failure cannot erase a newer recording registration', async () => {
  const stream = { start: jest.fn(), isStreaming: false };
  let reject!: (error: Error) => void;
  native.prepare.mockReturnValueOnce('old').mockReturnValueOnce('new');
  native.start.mockReturnValueOnce(new Promise((_done, fail) => { reject = fail; }));
  const old = configureBackgroundCapture(true, stream);
  const failure = expect(old).rejects.toThrow('cancelled');
  await Promise.resolve();
  await configureBackgroundCapture(false, stream);
  await configureBackgroundCapture(true, stream);
  reject(new Error('cancelled')); await failure;
  await startPcmCapture(stream, true);
  expect(native.startCapture).toHaveBeenLastCalledWith('new');
  expect(native.release.mock.calls.every(([id]) => id === 'old')).toBe(true);
});
it('does not offer native background capture on web', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  expect(supportsBackgroundCapture()).toBe(false);
  await expect(configureBackgroundCapture(true)).rejects.toThrow('desteklenmiyor');
  expect(native.start).not.toHaveBeenCalled();
});

it('does not offer the Android foreground service on iOS', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  expect(supportsBackgroundCapture()).toBe(false);
  await expect(configureBackgroundCapture(true)).rejects.toThrow('desteklenmiyor');
  expect(native.start).not.toHaveBeenCalled(); expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
});

it('configures iOS per stream without requesting Android notification permission', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  const stream = { workcubePcmLifecycleVersion: 1, configureBackgroundCapture: jest.fn() };
  expect(supportsBackgroundCapture(stream)).toBe(true);
  await configureBackgroundCapture(true, stream);
  await configureBackgroundCapture(false, stream);
  expect(stream.configureBackgroundCapture.mock.calls).toEqual([[true], [false]]);
  expect(native.start).not.toHaveBeenCalled();
  expect(native.stop).not.toHaveBeenCalled();
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
});

it('surfaces native iOS configuration errors before capture', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  const stream = { workcubePcmLifecycleVersion: 1, configureBackgroundCapture: () => { throw new Error('Stop first'); } };
  await expect(configureBackgroundCapture(true, stream)).rejects.toThrow('Stop first');
  expect(native.start).not.toHaveBeenCalled();
});
