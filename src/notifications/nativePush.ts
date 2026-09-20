import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { mobileSession } from '../auth/mobileSession';
import { NativePushManager, type PushIdentity, type PushReceipt, type PushScope } from './nativePushManager';
import { meetingNotificationTarget } from './meetingNotification';

const BASE = 'https://testai.acik.com';
const KEY = 'platform-mobile.native-push.v1';
const UUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
let accountGeneration = 0;
export function nativePushConfiguration(): (PushScope & { org: string }) | null {
  const config = Constants.expoConfig?.extra?.nativePush;
  if (config?.platforms && (!Array.isArray(config.platforms) || !config.platforms.includes(Platform.OS))) return null;
  if (!config || config.enabled !== true || config.environment !== 'TEST' ||
      typeof config.orgId !== 'string' || !config.orgId || config.orgId.length > 64) return null;
  const applicationId = Platform.OS === 'android' ? Constants.expoConfig?.android?.package : Constants.expoConfig?.ios?.bundleIdentifier;
  if (!applicationId || !['android', 'ios'].includes(Platform.OS)) return null;
  return { applicationId, provider: Platform.OS === 'android' ? 'FCM' : 'APNS', environment: 'TEST', org: config.orgId };
}
async function read(): Promise<PushReceipt | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || !UUID.test(value.installationId) || typeof value.owner !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.owner) || typeof value.enabled !== 'boolean' ||
      typeof value.applicationId !== 'string' || !/^[A-Za-z0-9_.-]{1,255}$/.test(value.applicationId) ||
      !['FCM', 'APNS'].includes(value.provider) || !['TEST', 'PRODUCTION'].includes(value.environment)) throw new Error();
    return value;
  } catch { throw new Error('Bildirim kaydı okunamadı; güvenli temizlik gerekli.'); }
}
async function identity(): Promise<PushIdentity | null> {
  const session = await mobileSession.valid();
  const config = nativePushConfiguration();
  if (!session || !config) return null;
  return sessionIdentity(session.jwt, config.org);
}
async function sessionIdentity(jwt: string, org: string): Promise<PushIdentity> {
  try {
    const encoded = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    if (claims.iss !== `${BASE}/realms/platform-test` || typeof claims.sub !== 'string' || !claims.sub) throw new Error();
    const subscriber = String(claims.subscriberId ?? claims.userId ?? claims.sub);
    if (!subscriber || subscriber.length > 128) throw new Error();
    return { jwt, org, subscriber,
      owner: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([claims.iss, claims.sub, org, subscriber])) };
  } catch { throw new Error('Bildirim kullanıcısı doğrulanamadı.'); }
}
async function request(who: PushIdentity, path: string, method: string, body: object): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const result = await fetch(`${BASE}/api/v1/notify/native-push/registrations${path}`, {
      method, signal: controller.signal, headers: { Authorization: `Bearer ${who.jwt}`,
        'X-Org-Id': who.org, 'X-Subscriber-Id': who.subscriber, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!result.ok) throw new Error(`Bildirim kaydı sunucuda tamamlanamadı (${result.status}).`);
    if (method === 'POST') {
      const response = await result.json();
      if (response.status !== 'registered' || !UUID.test(response.registrationId)) throw new Error('Bildirim kayıt yanıtı doğrulanamadı.');
    }
  } finally { clearTimeout(timer); }
}
const manager = new NativePushManager({ read,
  write: value => SecureStore.setItemAsync(KEY, JSON.stringify(value), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  remove: () => SecureStore.deleteItemAsync(KEY), uuid: () => Crypto.randomUUID(),
  register: (who, receipt, token) => request(who, '', 'POST', { installationId: receipt.installationId,
    applicationId: receipt.applicationId, provider: receipt.provider, environment: receipt.environment, token }),
  unregister: (who, receipt) => request(who, `/installations/${receipt.installationId}`, 'DELETE', {
    applicationId: receipt.applicationId, provider: receipt.provider, environment: receipt.environment }),
});

export async function enableNativePush(): Promise<void> {
  const generation = accountGeneration;
  const scope = nativePushConfiguration();
  const who = await identity();
  if (!scope || !who) throw new Error('Bildirimler bu sürümde henüz kullanıma açılmadı.');
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('meeting-updates', {
    name: 'Toplantı güncellemeleri', importance: Notifications.AndroidImportance.DEFAULT });
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Bildirim izni verilmedi. Telefon ayarlarından izin verebilirsiniz.');
  const device = await Notifications.getDevicePushTokenAsync();
  // Identity recheck closes the permission-dialog / account-change race.
  const current = await identity();
  if (generation !== accountGeneration || current?.owner !== who.owner) throw new Error('Hesap değişti; bildirimleri yeniden açın.');
  if (typeof device.data !== 'string') throw new Error('Cihaz bildirim adresi alınamadı.');
  await manager.enable(who, scope, device.data);
}
export async function disableNativePush(): Promise<boolean> {
  accountGeneration += 1;
  const who = await identity().catch(() => null);
  return manager.disable(who);
}
export async function refreshNativePush(): Promise<void> {
  await renewNativePush(() => Notifications.getDevicePushTokenAsync());
}

/** Expo emits this event from the token getter too. Never call that getter here. */
export async function rotateNativePush(device: Notifications.DevicePushToken): Promise<void> {
  await renewNativePush(async () => device);
}

function matchesScope(receipt: PushReceipt, scope: PushScope | null): boolean {
  return !!scope && receipt.applicationId === scope.applicationId &&
    receipt.provider === scope.provider && receipt.environment === scope.environment;
}

async function renewNativePush(deviceToken: () => Promise<Notifications.DevicePushToken>): Promise<void> {
  const generation = accountGeneration;
  const scope = nativePushConfiguration();
  const receipt = await read();
  if (!receipt?.enabled || !scope || !matchesScope(receipt, scope)) return;
  const who = await identity();
  if (!who || who.owner !== receipt.owner) return;
  const isCurrent = (currentReceipt: PushReceipt) => {
    const currentScope = nativePushConfiguration();
    return generation === accountGeneration && mobileSession.snapshot()?.jwt === who.jwt &&
      currentReceipt.owner === who.owner && currentScope?.org === scope.org && matchesScope(currentReceipt, currentScope);
  };
  if (!(await Notifications.getPermissionsAsync()).granted) {
    if (!await manager.disable(who, isCurrent)) throw new Error('Bildirim izni kapalı; sunucu kaydı temizliği bağlantı bekliyor.');
    return;
  }
  const device = await deviceToken();
  if (device.type !== Platform.OS || typeof device.data !== 'string' || !device.data) return;
  // Checked inside the ordered queue, after storage awaits: a late event cannot
  // register across logout, a new login, or a different configured scope.
  await manager.rotate(who, device.data, isCurrent);
}

const hidden: Notifications.NotificationBehavior = {
  shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false,
};

/** Foreground only. No network, token requests, permission prompts or sensitive content. */
export async function foregroundMeetingBehavior(content: Notifications.NotificationContent): Promise<Notifications.NotificationBehavior> {
  if (!meetingNotificationTarget(content.data) || content.title !== 'Toplantı güncellemesi' ||
      content.body !== 'Toplantı sonucunu uygulamada görüntüleyebilirsiniz.' || content.subtitle ||
      ('attachments' in content && content.attachments?.length)) return hidden;
  const scope = nativePushConfiguration();
  const session = mobileSession.snapshot();
  if (!scope || !session) return hidden;
  const generation = accountGeneration;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const allowed = await Promise.race([
      (async () => {
        const receipt = await read();
        if (!receipt?.enabled || !matchesScope(receipt, scope)) return false;
        const who = await sessionIdentity(session.jwt, scope.org);
        return who.owner === receipt.owner;
      })(),
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 1000); }),
    ]);
    const currentScope = nativePushConfiguration();
    if (!allowed || generation !== accountGeneration || mobileSession.snapshot()?.jwt !== session.jwt ||
        currentScope?.org !== scope.org || currentScope.applicationId !== scope.applicationId ||
        currentScope.provider !== scope.provider || currentScope.environment !== scope.environment) return hidden;
    return { ...hidden, shouldShowBanner: true, shouldShowList: true };
  } catch { return hidden; }
  finally { if (timer) clearTimeout(timer); }
}
