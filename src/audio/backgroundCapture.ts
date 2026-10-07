import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import WorkcubePcmBackground from '../../modules/workcube-pcm-background';
import { supportsPcmLifecycle, type PcmLifecycleStream } from './pcmLifecycle';
const registrations = new WeakMap<PcmLifecycleStream, string>();

export const supportsBackgroundCapture = (stream?: PcmLifecycleStream) =>
  Platform.OS === 'ios' ? supportsPcmLifecycle(stream) : Platform.OS === 'android' &&
    !!WorkcubePcmBackground?.isAvailable() && WorkcubePcmBackground?.lifecycleVersion?.() === 1;

export const backgroundStopReason = (stream: PcmLifecycleStream) => Platform.OS === 'android' && supportsBackgroundCapture()
  ? WorkcubePcmBackground?.captureState(stream)?.reason : undefined;

export function listenBackgroundStop(stream: PcmLifecycleStream, onStop: (reason: string) => void) {
  if (Platform.OS !== 'android' || !supportsBackgroundCapture()) return;
  return WorkcubePcmBackground?.addListener('onCaptureStopped', event => {
    const state = WorkcubePcmBackground?.captureState(stream);
    if (state?.id === event.id && state.reason) onStop(state.reason);
  });
}

export async function startPcmCapture(stream: PcmLifecycleStream & { start(): Promise<void> }, background: boolean) {
  if (Platform.OS === 'android' && background) {
    if (!supportsBackgroundCapture()) throw new Error('Arka plan kaydı bu sürümde desteklenmiyor.');
    const id = registrations.get(stream);
    if (!id) throw new Error('Kayıt bildirimi kapandı; mikrofon başlatılmadı.');
    await WorkcubePcmBackground!.startCapture(id);
  } else { await stream.start(); }
}

export async function configureBackgroundCapture(enabled: boolean, stream?: PcmLifecycleStream, isCurrent = () => true): Promise<void> {
  if (Platform.OS === 'ios') {
    if (supportsPcmLifecycle(stream)) stream!.configureBackgroundCapture!(enabled);
    else if (enabled) throw new Error('Bu sürümde iOS arka plan ses kaydı desteklenmiyor.');
    return;
  }
  if (!enabled) {
    const id = stream && registrations.get(stream);
    if (id) { registrations.delete(stream!); WorkcubePcmBackground?.release(id); }
    return;
  }
  if (!supportsBackgroundCapture()) throw new Error('Bu sürümde arka plan ses kaydı desteklenmiyor.');
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
  if (!isCurrent()) return;
  if (!permission.granted) throw new Error('Arka plan kaydı için görünür kayıt bildirimi gerekiyor. Ayarlar’dan bildirim iznini açın veya arka plan kaydını kapatın.');
  if (!stream) throw new Error('Kayıt için mikrofon bağlantısı gerekiyor.');
  const id = WorkcubePcmBackground!.prepare(stream);
  registrations.set(stream, id);
  try {
    await WorkcubePcmBackground!.start(id);
    if (isCurrent()) return;
  } catch (error) {
    WorkcubePcmBackground!.release(id);
    if (registrations.get(stream) === id) registrations.delete(stream);
    throw error;
  }
  WorkcubePcmBackground!.release(id);
  if (registrations.get(stream) === id) registrations.delete(stream);
}
