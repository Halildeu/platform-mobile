import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { requestFailure } from './requestFailure';
import { mobileSession } from '../auth/mobileSession';
import { SessionExpired } from '../auth/sessionManager';
import { parsePersistedResult } from '../analysis/persistedResult';
import { parseSavedTranscript, type SavedTranscriptDocument } from '../analysis/savedTranscript';
import { parseSpeakerLabels, validSpeakerDocument, type SpeakerLabelEdit } from '../analysis/speakerLabels';
import { disableNativePush } from '../notifications/nativePush';
import { resultExporter } from '../analysis/nativeResultExport';
import { bufferJournal } from './nativeBufferJournal';

export const BASE_URL = 'https://testai.acik.com';
const ISSUER = `${BASE_URL}/realms/platform-test`;
export const CLIENT_ID = 'platform-mobile';
export const REDIRECT_URI = 'workcube://oauthredirect';
const LIFECYCLE_KEY = 'platform-mobile.platform-test.recording-lifecycle.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Reference identity distinguishes a verified 404 from an untrusted 200 JSON payload.
const ABSENT_GATEWAY_RECEIPT = Object.freeze({ absent: true });
type PendingLifecycle = { ownerHash: string; meetingId: string; externalSessionId: string; startedAt: string; endedAt: string | null; version?: 2; completion?: 'unknown' | 'confirmed'; abandon?: { endedAt: string; canonical: boolean } };
let lifecycleWork: Promise<unknown> = Promise.resolve();
let activeLifecycleSession: string | null = null;
let stoppedLifecycleSession: string | null = null;
/** Local microphone state only; this never grants permission to finish on the server. */
export function captureStopped(sessionId: string): void {
  if (activeLifecycleSession === sessionId) {
    activeLifecycleSession = null;
    stoppedLifecycleSession = sessionId;
  }
}
function orderedLifecycle<T>(work: () => Promise<T>): Promise<T> {
  const next = lifecycleWork.then(work, work);
  lifecycleWork = next.catch(() => {});
  return next;
}
export async function lifecycleOwner(jwt: string): Promise<string> {
  try {
    if (jwt.length > 16384 || jwt.split('.').length !== 3) throw new Error();
    const encoded = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    if (claims.iss !== ISSUER || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 256) throw new Error();
    // Local replay isolation only. The server still authenticates/authorizes every request.
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,
      JSON.stringify([claims.iss, claims.sub, claims.companyId ?? null, claims.tenant_id ?? null]));
  } catch { throw new Error('Kayıt kullanıcısı doğrulanamadı.'); }
}
function validInstant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
const MAX_PENDING = 20;
const MAX_JOURNAL_BYTES = 32768;
function decodeLifecycle(parsed: PendingLifecycle): PendingLifecycle {
  if (!parsed || typeof parsed.ownerHash !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.ownerHash) || !UUID.test(parsed.meetingId)
    || !/^SES-[A-Za-z0-9._:-]{1,124}$/.test(parsed.externalSessionId) || !validInstant(parsed.startedAt)
    || !(parsed.endedAt === null || (validInstant(parsed.endedAt) && Date.parse(parsed.endedAt) >= Date.parse(parsed.startedAt)))
    || !(parsed.version === undefined || (parsed.version === 2 && ['unknown', 'confirmed'].includes(parsed.completion!)))
    || !(parsed.abandon === undefined || (parsed.version === 2 && validInstant(parsed.abandon?.endedAt)
      && Date.parse(parsed.abandon.endedAt) >= Date.parse(parsed.startedAt) && typeof parsed.abandon.canonical === 'boolean'))) {
    throw new Error('Bekleyen kayıt bağlantısı doğrulanamadı. Yeni kayıt başlatılmadı.');
  }
  // Retain only bounded metadata, including legacy timestamps and unfinished abandonment intent.
  return { ownerHash: parsed.ownerHash, meetingId: parsed.meetingId, externalSessionId: parsed.externalSessionId,
    startedAt: parsed.startedAt, endedAt: parsed.endedAt,
    ...(parsed.version === 2 ? { version: 2, completion: parsed.completion } : {}),
    ...(parsed.abandon ? { abandon: { endedAt: parsed.abandon.endedAt, canonical: parsed.abandon.canonical } } : {}) };
}
async function readLifecycles(ownerHash: string): Promise<PendingLifecycle[]> {
  let raw: string | null;
  try { raw = await SecureStore.getItemAsync(LIFECYCLE_KEY); }
  catch { throw new Error('Bekleyen kayıt bağlantısı cihazdan okunamadı.'); }
  if (!raw) return [];
  let records: PendingLifecycle[];
  try {
    if (raw.length > MAX_JOURNAL_BYTES) throw new Error();
    const parsed = JSON.parse(raw);
    const values = parsed?.version === 3 ? parsed.records : [parsed];
    if (!Array.isArray(values) || !values.length || values.length > MAX_PENDING) throw new Error();
    records = values.map(decodeLifecycle);
    if (new Set(records.map(row => row.externalSessionId)).size !== records.length) throw new Error();
  } catch { throw new Error('Bekleyen kayıt bağlantısı doğrulanamadı. Yeni kayıt başlatılmadı.'); }
  if (records.some(row => row.ownerHash !== ownerHash)) throw new Error('Bekleyen kayıt için önceki kullanıcıyla giriş gerekli.');
  return records;
}
async function readLifecycle(jwt: string, sessionId?: string, meetingId?: string): Promise<PendingLifecycle | null> {
  const records = await readLifecycles(await lifecycleOwner(jwt));
  return records.find(row => (!sessionId || row.externalSessionId === sessionId) && (!meetingId || row.meetingId === meetingId)) ?? null;
}
async function saveLifecycles(records: PendingLifecycle[]): Promise<void> {
  // The same SecureStore key makes migration atomic: no copy/delete handoff window.
  const raw = records.length === 1 ? JSON.stringify(records[0]) : JSON.stringify({ version: 3, records });
  if (records.length > MAX_PENDING || raw.length > MAX_JOURNAL_BYTES) throw new Error('Bekleyen kayıt sınırına ulaşıldı. Önce eski kayıtların kapanışını tamamlayın.');
  try {
    if (!records.length) {
      await SecureStore.deleteItemAsync(LIFECYCLE_KEY);
      if (await SecureStore.getItemAsync(LIFECYCLE_KEY) !== null) throw new Error();
    } else {
      await SecureStore.setItemAsync(LIFECYCLE_KEY, raw, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      if (await SecureStore.getItemAsync(LIFECYCLE_KEY) !== raw) throw new Error();
    }
  } catch { throw new Error(records.length ? 'Kayıt bağlantısı cihazda doğrulanamadı.' : 'Kayıt bağlantısı temizliği doğrulanamadı.'); }
}
async function writeLifecycle(value: PendingLifecycle): Promise<void> {
  const records = await readLifecycles(value.ownerHash);
  const index = records.findIndex(row => row.externalSessionId === value.externalSessionId);
  if (index < 0) records.push(value); else records[index] = value;
  await saveLifecycles(records);
}
async function syncLifecycle(jwt: string, pending: PendingLifecycle): Promise<void> {
  const result = await request(`/api/v1/admin/meetings/${pending.meetingId}/recording-lifecycle`, jwt,
    { externalSessionId: pending.externalSessionId, startedAt: pending.startedAt, endedAt: pending.endedAt }, undefined, 'PUT');
  if (!result || result.meetingId !== pending.meetingId || !UUID.test(String(result.sessionId))
    || result.externalSessionId !== pending.externalSessionId || !validInstant(result.startedAt)
    || Date.parse(result.startedAt) !== Date.parse(pending.startedAt)
    || !['IN_PROGRESS', 'COMPLETED'].includes(String(result.meetingStatus))
    || !['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'].includes(String(result.transcriptStatus))
    || (pending.endedAt === null && result.meetingStatus !== 'IN_PROGRESS')
    || (pending.endedAt === null ? result.endedAt !== null
      : !validInstant(result.endedAt) || Date.parse(result.endedAt) !== Date.parse(pending.endedAt))) {
    throw new Error('Toplantı kayıt bağlantısı doğrulanamadı.');
  }
}
async function clearLifecycle(pending: PendingLifecycle): Promise<void> {
  const records = await readLifecycles(pending.ownerHash);
  await saveLifecycles(records.filter(row => row.externalSessionId !== pending.externalSessionId));
}
function matchesLifecycle(result: Record<string, unknown> | null, pending: PendingLifecycle, endedAt: string): boolean {
  return !!result && !Array.isArray(result) && result.meetingId === pending.meetingId && UUID.test(String(result.sessionId))
    && result.externalSessionId === pending.externalSessionId && validInstant(result.startedAt)
    && Date.parse(result.startedAt) === Date.parse(pending.startedAt) && validInstant(result.endedAt)
    && Date.parse(result.endedAt) === Date.parse(endedAt);
}
async function finishPending(jwt: string, pending: PendingLifecycle): Promise<void> {
  if (pending.abandon) throw new Error('Eksik kayıt kapanışı bekliyor; tamamlandı olarak kapatılamaz.');
  if (pending.version !== 2 || pending.completion !== 'confirmed') {
    if (pending.version === undefined && pending.endedAt !== null) {
      const prior = await request(`/api/v1/admin/meetings/${pending.meetingId}/recording-lifecycle/${encodeURIComponent(pending.externalSessionId)}`, jwt);
      if (!matchesLifecycle(prior, pending, pending.endedAt) || prior.recordingIncomplete !== false) {
        throw new Error('Önceki kaydın sunucu durumu eşleşmedi; kayıt korunuyor.');
      }
      // Read-only reconciliation, NOT proof of lossless audio or permission for a new finish event.
      await clearLifecycle(pending); return;
    }
    throw new Error('Sesin eksiksiz kapanışı doğrulanmadı. Bekleyen kayıt bölümünü açın.');
  }
  await bufferJournal.assertFinishAllowed(pending.ownerHash, pending.externalSessionId);
  if (pending.endedAt === null) {
    const finishedAtMs = await finishGateway(jwt, pending.externalSessionId);
    if (finishedAtMs < Date.parse(pending.startedAt) || finishedAtMs > 8640000000000000) {
      throw new Error('Kayıt kapanış zamanı doğrulanamadı.');
    }
    pending = { ...pending, endedAt: new Date(finishedAtMs).toISOString() };
    await writeLifecycle(pending);
  }
  await syncLifecycle(jwt, pending);
  await clearLifecycle(pending);
}
export const CONSENT = 'Bu kısa test sırasında mikrofon sesim, konuşmamı yazıya dönüştürmek için Workcube sunucusuna şifreli bağlantıyla iletilecek. Cihazda ses dosyası saklanmayacak. Ses işlemeyi kabul ediyorum.';

export async function restoreSession() {
  const value = await mobileSession.valid();
  return value ? { jwt: value.jwt, expiresAt: value.expiresAt } : null;
}
export async function logout(): Promise<boolean> {
  // Invalidates in-flight exports before remote revocation. Failed cleanup is retried by the cache sweep.
  await resultExporter.cleanup(true).catch(() => {});
  const pushCleared = await disableNativePush().catch(() => false);
  const sessionCleared = await mobileSession.logout();
  return pushCleared && sessionCleared;
}
export async function validSession(minRemainingMs = 60000): Promise<{ jwt: string; expiresAt: number }> {
  const session = await mobileSession.valid(minRemainingMs);
  if (!session) throw new SessionExpired();
  return { jwt: session.jwt, expiresAt: session.expiresAt };
}

export async function login(): Promise<{ jwt: string; expiresAt: number }> {
  // Offline cleanup remains pending; never prevent reauthentication needed to finish it.
  // NativePushManager prevents a different account from taking over that receipt.
  await disableNativePush().catch(() => false);
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

async function request(path: string, jwt: string, body?: object, key?: string, method?: 'PUT', allowMissingSession = false): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const correlationId = Crypto.randomUUID();
  const utc = new Date().toISOString();
  const stage = path === '/api/v1/admin/meetings' ? 'Yeni toplantı oluşturma'
    : path.startsWith('/api/v1/admin/meetings?') ? 'Toplantı listesi'
      : path.endsWith('/consents') ? 'Kayıt onayı'
        : path.endsWith('/finish') ? 'Kayıt kapanışı'
          : path.endsWith('/speaker-labels') ? 'Konuşmacı adı'
            : path.endsWith('/intelligence/result') ? 'Kalıcı toplantı sonucu'
            : path.endsWith('/recording-lifecycle') ? 'Toplantı kayıt bağlantısı' : 'Ses oturumu';
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: method ?? (body !== undefined ? 'POST' : 'GET'), signal: controller.signal,
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
      if (allowMissingSession && response.status === 404 && details.code === 'AUDIO_GATEWAY_SESSION_NOT_FOUND') return ABSENT_GATEWAY_RECEIPT;
      const serverId = details.correlationId ?? response.headers?.get('X-Correlation-Id');
      const safeId = typeof serverId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serverId)
        ? serverId : correlationId;
      throw new Error(`${requestFailure(stage, response.status, { ...details, correlationId: safeId })} UTC: ${utc}`);
    }
    return await response.json();
  } finally { clearTimeout(timer); }
}

export interface Meeting { id: string; title: string }
export async function savedTranscript(meetingId: string, analysisRunId: string): Promise<SavedTranscriptDocument> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(meetingId) || !uuid.test(analysisRunId)) throw new Error('Geçersiz toplantı sonucu.');
  const session = await validSession(30000);
  return parseSavedTranscript(await request(`/api/v1/admin/meetings/${meetingId}/intelligence/results/${analysisRunId}/transcript`, session.jwt), meetingId, analysisRunId);
}
export async function persistedResult(meetingId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(meetingId)) throw new Error('Geçersiz toplantı.');
  const session = await validSession(30000);
  await orderedLifecycle(async () => {
    const pending = await readLifecycle(session.jwt, undefined, meetingId);
    // Only a confirmed finish is replayed while reading; never stop an active capture.
    if (pending?.meetingId === meetingId && pending.endedAt !== null && !pending.abandon) await finishPending(session.jwt, pending);
  });
  return parsePersistedResult(await request(`/api/v1/admin/meetings/${meetingId}/intelligence/result`, session.jwt), meetingId);
}
export async function savedSpeakerLabels(document: SavedTranscriptDocument, owner: number, edit?: SpeakerLabelEdit) {
  if (!validSpeakerDocument(document) || mobileSession.contentScope() !== owner) throw new Error('Konuşmacı kaydı değişti.');
  const session = await validSession(30000);
  if (mobileSession.contentScope() !== owner) throw new Error('Oturum değişti.');
  const response = await request(`/api/v1/admin/meetings/${document.meetingId}/intelligence/results/${document.analysisRunId}/transcript/speaker-labels`,
    session.jwt, edit, undefined, edit ? 'PUT' : undefined);
  if (mobileSession.contentScope() !== owner) throw new Error('Oturum değişti.');
  const result = parseSpeakerLabels(response, document);
  if (edit && (result.revision !== edit.expectedRevision + 1
    || (result.labels.find(label => label.scope === edit.scope && label.speaker === edit.speaker)?.name ?? null) !== edit.name))
    throw new Error('Konuşmacı adı kaydı doğrulanamadı.');
  return result;
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

export function begin(jwt: string, meetingId: string, onStage?: (stage: string) => void): Promise<string> {
  return orderedLifecycle(async () => {
    if (!UUID.test(meetingId)) throw new Error('Geçersiz toplantı.');
    if (activeLifecycleSession) throw new Error('Etkin kayıt durdurulmadan yeni kayıt başlatılamaz.');
    const ownerHash = await lifecycleOwner(jwt);
    const records = await readLifecycles(ownerHash);
    // Closure belongs to its meeting, regardless of how the selected meeting was opened.
    // Unrelated receipts remain recoverable; they are never finished or discarded here.
    const toResolve = records.filter(row => row.meetingId === meetingId);
    for (const previous of toResolve) {
      onStage?.('Önceki kaydın kapanış bağlantısı doğrulanıyor');
      await finishPending(jwt, previous);
    }
    const remaining = await readLifecycles(ownerHash);
    // Reserve the metadata slot before allocating anything remotely. Every serialized receipt
    // is at most 1 KiB; this conservative size check also bounds later terminal updates.
    if (remaining.length >= MAX_PENDING || JSON.stringify(remaining).length + 1024 > MAX_JOURNAL_BYTES) {
      throw new Error('Bekleyen kayıt sınırına ulaşıldı. Önce eski kayıtların kapanışını tamamlayın.');
    }
    return beginLinked(jwt, meetingId, ownerHash, onStage);
  });
}
async function beginLinked(jwt: string, meetingId: string, ownerHash: string, onStage?: (stage: string) => void): Promise<string> {
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
  if (typeof session.sessionId !== 'string' || !/^SES-[A-Za-z0-9._:-]{1,124}$/.test(session.sessionId)) {
    throw new Error('Ses oturumu doğrulanamadı.');
  }
  if (session.sttProvider !== 'speechmatics' || session.transcriptionMode !== 'realtime') {
    throw new Error('Speechmatics canlı ses seçimi sunucu tarafından doğrulanmadı. Kayıt başlatılmadı.');
  }
  if (typeof session.sessionStartMs !== 'number' || !Number.isSafeInteger(session.sessionStartMs)
    || session.sessionStartMs < 0 || session.sessionStartMs > 8640000000000000) {
    throw new Error('Ses oturumu başlangıç zamanı doğrulanamadı.');
  }
  const pending: PendingLifecycle = { ownerHash, meetingId, externalSessionId: session.sessionId,
    startedAt: new Date(session.sessionStartMs).toISOString(), endedAt: null, version: 2, completion: 'unknown' };
  try {
    await writeLifecycle(pending);
    onStage?.('Toplantı kayıt bağlantısı doğrulanıyor');
    await syncLifecycle(jwt, pending);
  } catch (error) {
    // The microphone has not started. Close only the newly allocated gateway session.
    // Retain one bounded, encrypted metadata receipt for an authenticated retry.
    try {
      const endedAtMs = await finishGateway(jwt, session.sessionId);
      if (endedAtMs >= session.sessionStartMs && endedAtMs <= 8640000000000000) {
        await writeLifecycle({ ...pending, endedAt: new Date(endedAtMs).toISOString(), completion: 'confirmed' });
      }
    } catch { /* Unconfirmed cleanup is not a successful recording start. */ }
    throw error;
  }
  onStage?.('Ses sağlayıcısı doğrulandı: Speechmatics (canlı)');
  activeLifecycleSession = session.sessionId;
  return session.sessionId;
}

/** Only the active capture can persist new proof; retries consume that proof, never manufacture it. */
export function completeCapture(jwt: string, sessionId: string, uninterruptedDrain: boolean): Promise<boolean> {
  return orderedLifecycle(async () => {
    captureStopped(sessionId);
    if (stoppedLifecycleSession !== sessionId) throw new Error('Etkin kayıt eşleşmedi; kapanış onayı saklanmadı.');
    const pending = await readLifecycle(jwt, sessionId);
    if (!pending || pending.externalSessionId !== sessionId || pending.abandon) {
      throw new Error('Etkin kayıt eşleşmedi; kapanış onayı saklanmadı.');
    }
    const stopped: PendingLifecycle = { ...pending, version: 2, completion: uninterruptedDrain ? 'confirmed' : 'unknown' };
    await writeLifecycle(stopped);
    stoppedLifecycleSession = null; // Consume proof only after durable acknowledgement.
    if (!uninterruptedDrain) return false;
    // Network refresh follows persistence. A refresh failure cannot erase real drain proof,
    // and a long recording must not send its stale access token to the finish endpoint.
    const current = await validSession(15000);
    if (await lifecycleOwner(current.jwt) !== stopped.ownerHash) throw new Error('Kayıt kullanıcısı değişti; kapanış bilgisi korunuyor.');
    await finishPending(current.jwt, stopped);
    return true;
  });
}

export async function pendingRecording(jwt: string, meetingId?: string) {
  const pending = await orderedLifecycle(async () => (meetingId ? await readLifecycle(jwt, undefined, meetingId) : null) ?? await readLifecycle(jwt));
  return pending ? { meetingId: pending.meetingId, sessionId: pending.externalSessionId,
    incomplete: pending.completion !== 'confirmed', abandoning: !!pending.abandon } : null;
}

export function abandonRecording(jwt: string, sessionId: string): Promise<void> {
  return orderedLifecycle(async () => {
    let pending = await readLifecycle(jwt, sessionId);
    if (!pending || pending.externalSessionId !== sessionId || activeLifecycleSession) throw new Error('Bekleyen kayıt eşleşmedi veya mikrofon hâlâ etkin.');
    if (!pending.abandon) {
      pending = { ...pending, version: 2, completion: 'unknown', abandon: {
        endedAt: new Date(Math.max(Date.now(), Date.parse(pending.startedAt))).toISOString(), canonical: false } };
      await writeLifecycle(pending); // Stable intent before any server write, including unknown response/restart.
    }
    const intent = pending.abandon!;
    if (!intent.canonical) {
      const result = await request(`/api/v1/admin/meetings/${pending.meetingId}/recording-lifecycle/abandon`, jwt,
        { externalSessionId: pending.externalSessionId, startedAt: pending.startedAt, endedAt: intent.endedAt }, undefined, 'PUT');
      if (!matchesLifecycle(result, pending, intent.endedAt) || result.recordingIncomplete !== true || result.transcriptStatus !== 'FAILED') {
        throw new Error('Eksik kayıt kapanışı sunucuda doğrulanamadı.');
      }
      pending = { ...pending, abandon: { ...intent, canonical: true } };
      await writeLifecycle(pending);
    }
    const response = await request(`/api/v1/audio-gateway/sessions/${encodeURIComponent(sessionId)}/abandon`, jwt,
      {}, `${sessionId}:mobile-abandon`, undefined, true);
    if (response !== ABSENT_GATEWAY_RECEIPT && (!response || response.sessionId !== sessionId || response.finalState !== 'ABANDONED'
      || !Number.isSafeInteger(response.finishedAtMs) || (response.finishedAtMs as number) < Date.parse(pending.startedAt)
      || typeof response.alreadyFinished !== 'boolean')) throw new Error('Ses oturumunun eksik kapanışı doğrulanamadı.');
    if ((await bufferJournal.list()).some(row => row.ownerHash === pending!.ownerHash && row.sessionId === sessionId)) {
      const { discardAbandonedBuffer } = await import('./encryptedChunkBuffer');
      await discardAbandonedBuffer(pending.ownerHash, sessionId);
    }
    await clearLifecycle(pending);
  });
}

export function finish(jwt: string, sessionId: string): Promise<void> {
  return orderedLifecycle(async () => {
    if (activeLifecycleSession) throw new Error('Etkin kayıt otomatik kapatılamaz.');
    const pending = await readLifecycle(jwt, sessionId);
    if (!pending || pending.externalSessionId !== sessionId) throw new Error('Kayıt bağlantısı bulunamadı; kapanış doğrulanamadı.');
    await finishPending(jwt, pending);
  });
}
async function finishGateway(jwt: string, sessionId: string): Promise<number> {
  const result = await request(`/api/v1/audio-gateway/sessions/${encodeURIComponent(sessionId)}/finish`, jwt, {}, `${sessionId}:mobile-finish`);
  // A terminal gateway acknowledgement is not proof of a persisted analysis result.
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || result.sessionId !== sessionId || result.finalState !== 'FINISHED'
    || typeof result.finishedAtMs !== 'number' || !Number.isSafeInteger(result.finishedAtMs)
    || result.finishedAtMs < 0 || typeof result.alreadyFinished !== 'boolean') {
    throw new Error('Kayıt kapanışı doğrulanamadı.');
  }
  return result.finishedAtMs;
}
