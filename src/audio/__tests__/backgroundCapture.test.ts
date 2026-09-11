import { Platform } from 'react-native';
import { AudioModule } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { configureBackgroundCapture, supportsBackgroundCapture } from '../backgroundCapture';

jest.mock('expo-audio', () => ({ AudioModule: { configurePcmBackground: jest.fn() } }));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn() }));
const configure = (AudioModule as unknown as { configurePcmBackground: jest.Mock }).configurePcmBackground;
const originalOS = Platform.OS;
beforeEach(() => { jest.clearAllMocks(); Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' }); });
afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS }));

it('refuses invisible recording when notification permission is denied', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: false } as Notifications.NotificationPermissionsStatus);
  await expect(configureBackgroundCapture(true)).rejects.toThrow('bildirim');
  expect(configure).not.toHaveBeenCalled(); expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});
it('enables native support only after permission succeeds', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: true } as Notifications.NotificationPermissionsStatus);
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({ granted: true } as Notifications.NotificationPermissionsStatus);
  await configureBackgroundCapture(true);
  expect(configure).toHaveBeenCalledWith(true);
});
it('turns the feature off without requesting permissions', async () => {
  await configureBackgroundCapture(false);
  expect(configure).toHaveBeenCalledWith(false); expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
});
it('does not offer native background capture on web', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  expect(supportsBackgroundCapture()).toBe(false);
  await expect(configureBackgroundCapture(true)).rejects.toThrow('desteklenmiyor');
  expect(configure).not.toHaveBeenCalled();
});

it('uses the iOS audio-session path without Android notification permission', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  await configureBackgroundCapture(true);
  expect(configure).toHaveBeenCalledWith(true); expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
});
