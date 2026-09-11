import { Platform } from 'react-native';
import { AudioModule } from 'expo-audio';
import * as Notifications from 'expo-notifications';

const native = AudioModule as typeof AudioModule & { configurePcmBackground?: (enabled: boolean) => void };
export const supportsBackgroundCapture = () => ['android', 'ios'].includes(Platform.OS) && typeof native.configurePcmBackground === 'function';

export async function configureBackgroundCapture(enabled: boolean): Promise<void> {
  if (!enabled) { native.configurePcmBackground?.(false); return; }
  if (!supportsBackgroundCapture()) throw new Error('Bu sürümde arka plan ses kaydı desteklenmiyor.');
  if (Platform.OS === 'ios') { native.configurePcmBackground!(true); return; }
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Arka plan kaydı için görünür kayıt bildirimi gerekiyor. Ayarlar’dan bildirim iznini açın veya arka plan kaydını kapatın.');
  native.configurePcmBackground!(true);
}
