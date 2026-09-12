import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { configureBackgroundCapture, supportsBackgroundCapture } from '../backgroundCapture';

jest.mock('../../../modules/workcube-pcm-background', () => ({
  __esModule: true,
  default: { isAvailable: jest.fn(() => true), start: jest.fn(), stop: jest.fn() },
}));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn() }));
const native = jest.requireMock('../../../modules/workcube-pcm-background').default as {
  isAvailable: jest.Mock; start: jest.Mock; stop: jest.Mock;
};
const originalOS = Platform.OS;
beforeEach(() => { jest.clearAllMocks(); Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' }); });
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS }));

it('refuses invisible recording when notification permission is denied', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: false } as Notifications.NotificationPermissionsStatus);
  await expect(configureBackgroundCapture(true)).rejects.toThrow('bildirim');
  expect(native.start).not.toHaveBeenCalled(); expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});
it('enables native support only after permission succeeds', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: true } as Notifications.NotificationPermissionsStatus);
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({ granted: true } as Notifications.NotificationPermissionsStatus);
  await configureBackgroundCapture(true);
  expect(native.start).toHaveBeenCalledTimes(1);
});
it('turns the feature off without requesting permissions', async () => {
  await configureBackgroundCapture(false);
  expect(native.stop).toHaveBeenCalledTimes(1); expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
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
