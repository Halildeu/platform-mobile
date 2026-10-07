import { DetailedCapture, DETAIL_MAX_RETENTION_MS, DETAIL_LIMIT, DETAIL_REPORT_CHARACTERS, type DetailEntry } from './detailedCapture';
import { SERVER_FAILURE_CODES } from '../audio/serverFailure';
/** The ordinary report persists metadata; explicitly enabled content uses a separate table/export. */
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
  transcript_connection_closed: 'Metin bağlantısı kesildi',
  analysis_stream: 'Analiz bağlantısı durumu', app_active: 'Uygulama önde',
  app_background: 'Uygulama arka planda', app_inactive: 'Uygulama geçici olarak etkin değil',
  saved_requested: 'Kalıcı sonuç istendi', saved_received: 'Kalıcı sonuç ve toplantı eşleşmesi doğrulandı',
  request_failed: 'Sunucu isteği başarısız', stop_requested: 'Kayıt bitirme işlemi başladı',
  drained: 'Ses akışı kapanış yanıtı', http_finish_started: 'HTTP kayıt kapanışı başladı',
  http_finished: 'HTTP FINISHED doğrulandı', capture_failed: 'Ses yakalama veya taşıma hatası',
  analysis_closed: 'Analiz aboneliği kapatıldı', session_closed: 'Uygulama oturumu kapatıldı',
  detail_started: 'Ayrıntılı tanılama açıldı', detail_failed: 'Ayrıntılı tanılama açılamadı (DETAIL_START)',
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
  appendDetail?(entry: DetailEntry, cutoff: number, limit: number): void;
  readDetails?(meeting: string, cutoff: number): { entries: DetailEntry[]; removed: number };
  clearDetails?(meeting: string): void;
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
    else if (key === 'serverErrorCode' && typeof value === 'string' && (SERVER_FAILURE_CODES as readonly string[]).includes(value)) data[key] = value;
    else if (key === 'reason' && typeof value === 'string' && reasons.has(value)) data[key] = value;
    else if (key === 'appVersion' && typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value)) data[key] = value;
    else if (key === 'sourceRevision' && typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)) data[key] = value;
  }
  return data;
}
export class DiagnosticHistory {
  private closed = false;
  private error = false;
  constructor(private readonly store: HistoryStore, private readonly now = Date.now) {}
  private cutoff() { return this.now() - HISTORY_DAYS * 86400000; }
  record(meeting: string | undefined, kind: DiagnosticKind, details: Details = {}) {
    try {
      if (this.closed || !meeting || !UUID.test(meeting) || !Object.hasOwn(kinds, kind)) return;
      this.store.append({ at: this.now(), meeting, kind, data: cleanDetails(details) }, this.cutoff(), HISTORY_LIMIT);
    }
    catch { this.error = true; } // Diagnostic failure must not terminate live audio.
  }
  failed() { return this.error; }
  beginDetailed(meeting: string, runId: string, platform: string, retentionMs?: number): DetailedCapture | null {
    try {
      // No implicit durable-content retention. Duration comes from the explicit one-run UI choice.
      if (this.closed || !UUID.test(meeting) || !UUID.test(runId) || !this.store.appendDetail ||
        !Number.isSafeInteger(retentionMs) || retentionMs! < 3600000 || retentionMs! > DETAIL_MAX_RETENTION_MS) return null;
      const expiresAt = this.now() + retentionMs!;
      let started = false;
      const capture = new DetailedCapture((payload, at) => {
        if (this.closed || at >= expiresAt) return false;
        try {
          this.store.appendDetail!({ at, expiresAt, meeting, runId, payload }, this.now(), DETAIL_LIMIT);
          started = true;
          return true;
        } catch { this.error = true; return false; }
      }, platform, this.now);
      // Do not claim capture is enabled when even the opening event could not be stored.
      return started ? capture : null;
    } catch { this.error = true; return null; }
  }
  detailedReport(meeting: string): string {
    if (this.closed || !UUID.test(meeting) || !this.store.readDetails) throw new Error('Ayrıntılı tanılama hazır değil.');
    const { entries, removed } = this.store.readDetails(meeting, this.now());
    const lines: string[] = [];
    let characters = 0;
    // Keep the newest contiguous evidence; do not construct an unbounded joined report.
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      const line = `${new Date(e.at).toISOString()} | run=${e.runId} | expires=${new Date(e.expiresAt).toISOString()} | ${JSON.stringify(e.payload)}`;
      if (characters + line.length + 1 > DETAIL_REPORT_CHARACTERS - 8192) break;
      lines.push(line); characters += line.length + 1;
    }
    lines.reverse();
    return ['Ayrıntılı mobil test raporu v1 — KONUŞMA METNİ VE KİŞİ ADLARI İÇEREBİLİR', `Toplantı: ${meeting}`,
      'Yalnız açıkça seçilen denemenin ilk 3 dakikası. Ham ses kaydedilmedi. Seçilen 1 veya 24 saatlik süre / hesap başına 5000 olay ve 2 MiB içerik. Rapor en fazla 524288 karakter.',
      `Süre/kota nedeniyle kaldırılan ayrıntılı olay (hesap toplamı): ${removed}. truncated=true: alan/karakter sınırında kısaltıldı.`,
      `Rapor boyut sınırı nedeniyle bu dışa aktarıma alınmayan eski olay: ${entries.length - lines.length}.`,
      'gateway_text: telefona gelen doğrulanmış metin alanlarıdır; sağlayıcının ham Speechmatics olayı değildir. Partial confirmed/tentative ayrıdır; text gösterim için birleşimdir.',
      'analysis_output: telefona gelen analizdir. observedAfterFinalSeq yalnız geliş sırasıdır; analizin o metni kullandığını kanıtlamaz. Sunucunun model girdisi ve ret nedenleri bu raporda YOKTUR.',
      'pcm: uygulamaya ulaşan PCM16 mono 16000Hz sesin 100ms pencereleri; RMS/peak 0–32768 ölçeğinde. firstSample bu denemenin yakalama başlangıcındandır; sağlayıcı sample aralığıyla eşit olduğu varsayılamaz.',
      'pcm_gap: ölçülmeyen tampon ve biliniyorsa atlanan örnek sayısı. sampleOriginKnown=false sonrasında firstSample mutlak konum olarak kullanılamaz.',
      'maxCallbackGapMs uygulamaya varış aralığıdır; akustik duraklama değildir. Tam sıfır örnekleri tek başına gürültü kapısını veya nedenini kanıtlamaz. sendAccepted sıraya kabulü gösterir, sağlayıcı teslimi değildir.',
      ...(this.error ? ['UYARI: Depolama hatası nedeniyle rapor eksik olabilir.'] : []),
      ...(entries.length ? lines
        : ['Bu toplantıda saklanmış ayrıntılı test kaydı yok.']),
    ].join('\n');
  }
  clearDetails(meeting: string) { if (!this.closed && UUID.test(meeting)) this.store.clearDetails?.(meeting); }
  shortReport(meeting: string): string {
    if (this.closed || !UUID.test(meeting)) throw new Error('Tanılama oturumu kapalı.');
    const { entries, removed } = this.store.read(meeting, this.cutoff());
    // Failure and its run/session precede noisy transcript events. Keep full lines.
    const selected = new Set<number>();
    const priorities: number[] = [];
    const last = (predicate: (e: Entry) => boolean) => {
      for (let i = entries.length - 1; i >= 0; i--) if (predicate(entries[i])) { priorities.push(i); return entries[i]; }
      return undefined;
    };
    const failure = last(e => e.kind === 'capture_failed');
    last(e => e.kind === 'request_failed');
    if (failure?.data.runId) {
      last(e => e.kind === 'transport' && e.data.runId === failure.data.runId);
      last(e => e.kind === 'run_started' && e.data.runId === failure.data.runId);
      last(e => e.kind === 'session' && e.data.runId === failure.data.runId);
    }
    for (const kind of ['run_started', 'session', 'transport', 'stop_requested', 'drained', 'http_finished'] as const)
      last(e => e.kind === kind);
    for (let i = entries.length - 1; i >= 0; i--) priorities.push(i);
    const lines: string[] = [];
    let characters = 0;
    for (const index of priorities) {
      if (selected.has(index)) continue;
      const e = entries[index];
      const line = `${new Date(e.at).toISOString()} | ${kinds[e.kind]} | ${JSON.stringify(e.data)}`;
      if (characters + line.length + 1 > 2600) continue;
      selected.add(index); lines.push(line); characters += line.length + 1;
    }
    return ['Kısa mobil tanılama v1', `Toplantı: ${meeting}`,
      'Öncelikli hata ve son olaylar; kronolojik sıra değildir. Ham ses ve konuşma metni içermez.',
      `Bu özette gösterilmeyen olay: ${entries.length - selected.size}. Saklama sınırı nedeniyle kaldırılan (hesap toplamı): ${removed}.`,
      'Tam geçmişi dosya olarak paylaşabilirsiniz. Sunucunun iç hata nedenini tek başına doğrulamaz.',
      ...(this.error ? ['UYARI: Depolama hatası nedeniyle geçmiş eksik olabilir.'] : []),
      ...(lines.length ? lines : ['Saklanmış teknik olay bulunmuyor.']),
    ].join('\n');
  }
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
