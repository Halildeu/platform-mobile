import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import { requestFailure } from './requestFailure';
import { mobileSession } from '../auth/mobileSession';
import { SessionExpired } from '../auth/sessionManager';
import { parsePersistedResult } from '../analysis/persistedResult';

export const BASE_URL = 'https://testai.acik.com';
const ISSUER = `${BASE_URL}/realms/platform-test`;
export const CLIENT_ID = 'platform-mobile';
export const REDIRECT_URI = 'workcube://oauthredirect';
export const CONSENT = 'Bu kısa test sırasında mikrofon sesim, konuşmamı yazıya dönüştürmek için Workcube sunucusuna şifreli bağlantıyla iletilecek. Cihazda ses dosyası saklanmayacak. Ses işlemeyi kabul ediyorum.';

export async function restoreSession() {
  const value = await mobileSession.valid();
  return value ? { jwt: value.jwt, expiresAt: value.expiresAt } : null;
}
export const logout = () => mobileSession.logout();
export async function validSession(minRemainingMs = 60000): Promise<{ jwt: string; expiresAt: number }> {
  const session = await mobileSession.valid(minRemainingMs);
  if (!session) throw new SessionExpired();
  return { jwt: session.jwt, expiresAt: session.expiresAt };
}

export async function login(): Promise<{ jwt: string; expiresAt: number }> {
  await mobileSession.clear();
  const discovery = await AuthSession.fetchDiscoveryAsync(ISSUER);
  const request = new AuthSession.AuthRequest({
    clientId: CLIENT_ID, redirectUri: REDIRECT_URI,
    scopes: ['openid', 'profile', 'email'],
    prompt: AuthSession.Prompt.Login,
    responseType: AuthSession.ResponseType.Code, usePKCE: true,
  });
  const result = await request.promptAsync(discovery);
  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new Error('Giriş penceresi kapandı. Yeniden giriş yapabilirsiniz.');
  }
  if (result.type !== 'success' || !result.params.code || !request.codeVerifier) {
    throw new Error('Giriş onaylanmadı veya güvenli dönüş doğrulanamadı. Yeniden giriş yapın.');
  }
  const token = await AuthSession.exchangeCodeAsync({
    clientId: CLIENT_ID, code: result.params.code, redirectUri: REDIRECT_URI,
    extraParams: { code_verifier: request.codeVerifier },
  }, discovery);
  if (!token.accessToken || !token.expiresIn || token.expiresIn < 120) {
    throw new Error('Test için yeterli süreli giriş alınamadı.');
  }
  await mobileSession.save({ jwt: token.accessToken, expiresAt: Date.now() + token.expiresIn * 1000, refreshToken: token.refreshToken, idToken: token.idToken });
  return validSession();
}

async function request(path: string, jwt: string, body?: object, key?: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const correlationId = Crypto.randomUUID();
  const utc = new Date().toISOString();
  const stage = path === '/api/v1/admin/meetings' ? 'Yeni toplantı oluşturma'
    : path.startsWith('/api/v1/admin/meetings?') ? 'Toplantı listesi'
      : path.endsWith('/consents') ? 'Kayıt onayı'
        : path.endsWith('/finish') ? 'Kayıt kapanışı'
          : path.endsWith('/intelligence/result') ? 'Kalıcı toplantı sonucu' : 'Ses oturumu';
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: body !== undefined ? 'POST' : 'GET', signal: controller.signal,
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', 'X-Correlation-Id': correlationId,
        ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }).catch(() => {
      const reason = controller.signal.aborted ? 'İstek 15 saniyede tamamlanmadı.' : 'Sunucudan HTTP yanıtı alınamadı; ağ bağlantısı kesilmiş olabilir.';
      throw new Error(`${stage}: ${reason} İşlemin sunucuda tamamlanıp tamamlanmadığı bilinmiyor. Takip: ${correlationId}. UTC: ${utc}`);
    });
    if (!response.ok) {
      if (response.status === 401) {
        await mobileSession.reject(jwt);
        throw new SessionExpired();
      }
      const payload: unknown = await response.json().catch(() => null);
      const details = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const serverId = details.correlationId ?? response.headers?.get('X-Correlation-Id');
      const safeId = typeof serverId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serverId)
        ? serverId : correlationId;
      throw new Error(`${requestFailure(stage, response.status, { ...details, correlationId: safeId })} UTC: ${utc}`);
    }
    return await response.json();
  } finally { clearTimeout(timer); }
}

export interface Meeting { id: string; title: string }
export async function persistedResult(meetingId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(meetingId)) throw new Error('Geçersiz toplantı.');
  const session = await validSession(30000);
  return parsePersistedResult(await request(`/api/v1/admin/meetings/${meetingId}/intelligence/result`, session.jwt), meetingId);
}
export async function createMeeting(jwt: string, title: string): Promise<Meeting> {
  const cleaned = title.trim();
  if (!cleaned || cleaned.length > 512) throw new Error('Toplantı adı 1–512 karakter olmalıdır.');
  // Identity, tenant and organizer are derived by the server; never supplied by the phone.
  const result = await request('/api/v1/admin/meetings', jwt, { title: cleaned });
  if (typeof result.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.id) || typeof result.title !== 'string') {
    throw new Error('Toplantı yanıtı doğrulanamadı. Tekrar oluşturmadan önce listeyi yenileyin.');
  }
  return { id: result.id, title: result.title };
}
export async function meetings(jwt: string): Promise<Meeting[]> {
  const page = await request('/api/v1/admin/meetings?page=0&size=20', jwt);
  if (!Array.isArray(page.content)) throw new Error('Toplantı listesi alınamadı.');
  return page.content.filter((item): item is Meeting =>
    typeof item?.id === 'string' && /^[0-9a-f-]{36}$/i.test(item.id) && typeof item.title === 'string');
}

export async function begin(jwt: string, meetingId: string, onStage?: (stage: string) => void): Promise<string> {
  const captureId = Crypto.randomUUID();
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, CONSENT);
  onStage?.('Kayıt onayının sunucuya kaydı');
  const consent = await request('/api/v1/audio-gateway/consents', jwt, {
    meetingId, captureId, consentVersion: 'mobile-test-v1', consentTextHash: `sha256:${hash}`, locale: 'tr-TR',
  });
  if (consent.meetingId !== meetingId || consent.captureId !== captureId || consent.consentTextHash !== `sha256:${hash}`) {
    throw new Error('Kayıt onayı doğrulanamadı.');
  }
  onStage?.('Canlı ses oturumu oluşturma');
  const session = await request('/api/v1/audio-gateway/sessions', jwt, {
    meetingId, deviceId: 'mobile-foreground-test', language: 'tr',
    audioFormat: 'PCM16', sampleRateHz: 16000, channels: 1,
    sttProvider: 'speechmatics', transcriptionMode: 'realtime',
  }, captureId);
  if (typeof session.sessionId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(session.sessionId)) {
    throw new Error('Ses oturumu doğrulanamadı.');
  }
  if (session.sttProvider !== 'speechmatics' || session.transcriptionMode !== 'realtime') {
    throw new Error('Speechmatics canlı ses seçimi sunucu tarafından doğrulanmadı. Kayıt başlatılmadı.');
  }
  onStage?.('Ses sağlayıcısı doğrulandı: Speechmatics (canlı)');
  return session.sessionId;
}

export async function finish(jwt: string, sessionId: string): Promise<void> {
  const result = await request(`/api/v1/audio-gateway/sessions/${encodeURIComponent(sessionId)}/finish`, jwt, {}, `${sessionId}:mobile-finish`);
  // A terminal gateway acknowledgement is not proof of a persisted analysis result.
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || result.sessionId !== sessionId || result.finalState !== 'FINISHED'
    || typeof result.finishedAtMs !== 'number' || !Number.isSafeInteger(result.finishedAtMs)
    || result.finishedAtMs < 0 || typeof result.alreadyFinished !== 'boolean') {
    throw new Error('Kayıt kapanışı doğrulanamadı.');
  }
}
