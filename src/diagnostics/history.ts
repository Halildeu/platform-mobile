/** Only allowlisted technical metadata crosses this persistence boundary. */
export const HISTORY_DAYS = 30;
export const HISTORY_LIMIT = 20000;
// Stable codes are append-only so previously stored events remain readable.
const stages = ['Mikrofon izni', 'Oturum geçerliliği', 'Kayıt bildirimi', 'Ses tamponu hazırlanıyor',
  'Ses bağlantısının açılması', 'Sunucu hazır; mikrofon başlatılıyor',
  'Önceki kaydın kapanış bağlantısı doğrulanıyor', 'Kayıt onayının sunucuya kaydı',
  'Canlı ses oturumu oluşturma', 'Toplantı kayıt bağlantısı doğrulanıyor',
  'Ses sağlayıcısı doğrulandı: Speechmatics (canlı)'];
export function diagnosticStage(value: string) { return stages.indexOf(value); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reasons = new Set(['user', 'notification', 'background', 'unmount', 'pcm_gap', 'capture_start', 'transport', 'storage', 'startup', 'unknown']);
const kinds = {
  opened: 'Toplantı tanılaması açıldı', run_started: 'Kayıt denemesi başladı',
  stage: 'Başlatma aşaması', capture_started: 'Mikrofon başladı', capture_stopped: 'Mikrofon durduruluyor',
  session: 'Ses oturumu oluşturuldu', transport: 'Ses taşıma sayaçları',
  transcript: 'Kesin metin olayı', analysis: 'Analiz sonucu alındı',
  analysis_stream: 'Analiz bağlantısı durumu', app_active: 'Uygulama önde',
  app_background: 'Uygulama arka planda', app_inactive: 'Uygulama geçici olarak etkin değil',
  saved_requested: 'Kalıcı sonuç istendi', saved_received: 'Kalıcı sonuç ve toplantı eşleşmesi doğrulandı',
  request_failed: 'Sunucu isteği başarısız', stop_requested: 'Kayıt bitirme işlemi başladı',
  drained: 'Ses akışı kapanış yanıtı', http_finish_started: 'HTTP kayıt kapanışı başladı',
  http_finished: 'HTTP FINISHED doğrulandı', capture_failed: 'Ses yakalama veya taşıma hatası',
  analysis_closed: 'Analiz aboneliği kapatıldı', session_closed: 'Uygulama oturumu kapatıldı',
} as const;
export type DiagnosticKind = keyof typeof kinds;
const metricKeys = new Set(['stage', 'capturedBuffers', 'capturedBytes', 'generatedFrames', 'sentFrames',
  'acknowledgedFrames', 'pendingFrames', 'expiredFrames', 'evictedFrames', 'lastSentSeq', 'lastAckSeq',
  'partialEvents', 'finalEvents', 'closeCode', 'reconnectAttempts', 'continuityLost', 'seq', 'characters',
  'periods', 'questions', 'speakerTurns', 'version', 'partial', 'decisions', 'actions', 'missingOwners',
  'summaryCharacters', 'microphoneOpen', 'success', 'status', 'background', 'sampleRate', 'channels',
  'elapsedMs', 'connection', 'bytes', 'heartbeat', 'valid', 'invalid', 'invalidJson', 'rejected', 'unknownEvents', 'overflows']);
export type Details = Record<string, unknown>;
export type Entry = {
  at: number; meeting: string; kind: DiagnosticKind; data: Record<string, number | boolean | string | null>;
};
export interface HistoryStore {
  append(entry: Entry, cutoff: number, limit: number): void;
  read(meeting: string, cutoff: number): { entries: Entry[]; removed: number };
  clear(meeting: string): void;
  close(): void;
}
export function decodeEntry(raw: string, meeting: string): Entry {
  if (raw.length > 8192) throw new Error('Tanılama kaydı geçersiz.');
  const value = JSON.parse(raw);
  if (!value || !Number.isSafeInteger(value.at) || value.at < 0 || value.meeting !== meeting || !UUID.test(meeting) ||
    typeof value.kind !== 'string' || !Object.hasOwn(kinds, value.kind) || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) {
    throw new Error('Tanılama kaydı geçersiz.');
  }
  return { at: value.at, meeting, kind: value.kind as DiagnosticKind, data: cleanDetails(value.data) };
}
export function cleanDetails(input: Details): Entry['data'] {
  const data: Entry['data'] = {};
  for (const [key, value] of Object.entries(input)) {
    if (['runId', 'sessionId', 'requestId'].includes(key) && typeof value === 'string' && UUID.test(value)) data[key] = value;
    else if (key === 'sessionId' && typeof value === 'string' && /^SES-[A-Za-z0-9._:-]{1,124}$/.test(value)) data[key] = value;
    else if (metricKeys.has(key) && (value === null || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isSafeInteger(value) && value >= -1))) data[key] = value;
    else if (key === 'platform' && ['android', 'ios', 'web'].includes(value as string)) data[key] = value as string;
    else if (key === 'reason' && typeof value === 'string' && reasons.has(value)) data[key] = value;
    else if (key === 'appVersion' && typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value)) data[key] = value;
  }
  return data;
}
export class DiagnosticHistory {
  private closed = false;
  private error = false;
  constructor(private readonly store: HistoryStore, private readonly now = Date.now) {}
  private cutoff() { return this.now() - HISTORY_DAYS * 86400000; }
  record(meeting: string | undefined, kind: DiagnosticKind, details: Details = {}) {
    if (this.closed || !meeting || !UUID.test(meeting) || !Object.hasOwn(kinds, kind)) return;
    try { this.store.append({ at: this.now(), meeting, kind, data: cleanDetails(details) }, this.cutoff(), HISTORY_LIMIT); }
    catch { this.error = true; } // Diagnostic failure must not terminate live audio.
  }
  failed() { return this.error; }
  report(meeting: string): string {
    if (this.closed || !UUID.test(meeting)) throw new Error('Tanılama oturumu kapalı.');
    const { entries, removed } = this.store.read(meeting, this.cutoff());
    return [
      'Mobil tanılama geçmişi v3', `Toplantı: ${meeting}`,
      `Bu hesap için son ${HISTORY_DAYS} gün; en fazla ${HISTORY_LIMIT} olay. Sınır nedeniyle kaldırılan olay (hesap toplamı): ${removed}.`,
      'Bu cihazdaki teknik olaylardır. Ham ses, konuşma metni, kişi adı ve giriş bilgisi içermez.',
      'Sunucunun iç işleme/ret nedenlerini veya uygulama kapalıyken olanları göstermez. Eski kayıp kayıtları geri oluşturmaz.',
      `Başlatma aşaması: ${stages.map((label, code) => `${code}=${label}`).join('; ')}; -1=tanımlanmamış aşama.`,
      ...(this.error ? ['UYARI: Bazı olaylar diske yazılamadı; rapor eksik olabilir.'] : []),
      ...(entries.length ? entries.map(e => `${new Date(e.at).toISOString()} | ${kinds[e.kind]} | ${JSON.stringify(e.data)}`)
        : ['Bu toplantı için saklanmış teknik olay bulunmuyor.']),
    ].join('\n');
  }
  clear(meeting: string) { if (!this.closed && UUID.test(meeting)) this.store.clear(meeting); }
  close() { if (!this.closed) { this.closed = true; this.store.close(); } }
}
