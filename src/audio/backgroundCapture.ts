import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import WorkcubePcmBackground from '../../modules/workcube-pcm-background';
import { supportsPcmLifecycle, type PcmLifecycleStream } from './pcmLifecycle';

export const supportsBackgroundCapture = (stream?: PcmLifecycleStream) =>
  Platform.OS === 'ios' ? supportsPcmLifecycle(stream) : Platform.OS === 'android' && !!WorkcubePcmBackground?.isAvailable();

export async function configureBackgroundCapture(enabled: boolean, stream?: PcmLifecycleStream): Promise<void> {
  if (Platform.OS === 'ios') {
    if (supportsPcmLifecycle(stream)) stream!.configureBackgroundCapture!(enabled);
    else if (enabled) throw new Error('Bu sürümde iOS arka plan ses kaydı desteklenmiyor.');
    return;
  }
  if (!enabled) {
    if (supportsBackgroundCapture()) WorkcubePcmBackground?.stop();
    return;
  }
  if (!supportsBackgroundCapture()) throw new Error('Bu sürümde arka plan ses kaydı desteklenmiyor.');
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Arka plan kaydı için görünür kayıt bildirimi gerekiyor. Ayarlar’dan bildirim iznini açın veya arka plan kaydını kapatın.');
  await WorkcubePcmBackground?.start();
}
