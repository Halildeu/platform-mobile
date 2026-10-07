import { parseRecordingProvenance, type RecordingProvenance } from './recordingProvenance';

export type SourceState = 'UNKNOWN' | 'AWAITING_CLOSURE' | 'QUIESCING' | 'FINALIZED' | 'FAILED';
type Occurrence = RecordingProvenance & { analysisRunId: string; finalizationVersion: number; finalizedAt: string };
export type ProcessingStatus = {
  meetingId: string; sessionId: string;
  source: RecordingProvenance & { tenantId: string; state: SourceState; cycleVersion: number | null;
    observationRevision: number | null; observedAt: string;
    failureCode: 'NO_VALID_SEGMENTS_BEFORE_DEADLINE' | 'INVALID_CANONICAL_SEGMENT' | null;
    finalizedOccurrence: Occurrence | null };
  savedResult: { state: 'NOT_FOUND'; observedAt: string } | (RecordingProvenance & {
    state: 'AVAILABLE'; observedAt: string; analysisRunId: string; finalizationVersion: number | null;
    finalizedAt: string | null; matchesCurrentSourceOccurrence: boolean | null;
  });
};
export type RecordingChoice = { id: string; meetingId: string; startedAt: string | null; createdAt: string };
export const canonicalId = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const invalid = () => new Error('Kayıt durumu yanıtı doğrulanamadı.');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string { if (!canonicalId(value)) throw invalid(); return value; }
function instant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
    || !Number.isFinite(Date.parse(value))) throw invalid();
  return value;
}
function version(value: unknown, minimum = 0): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw invalid();
  return value;
}
function provenance(value: Record<string, unknown>): RecordingProvenance {
  // This new endpoint has no legacy wire format with absent provenance fields.
  if (!('recordingOutcome' in value) || !('recordingIncompleteReason' in value)) throw invalid();
  return parseRecordingProvenance(value, invalid);
}

export function parseRecordingChoices(value: unknown, meetingId: string): RecordingChoice[] {
  if (!canonicalId(meetingId) || !Array.isArray(value) || value.length > 1000) throw invalid();
  const choices = value.map(raw => {
    const row = object(raw);
    if (row.meetingId !== meetingId) throw invalid();
    return { id: uuid(row.id), meetingId, startedAt: row.startedAt === null ? null : instant(row.startedAt), createdAt: instant(row.createdAt) };
  });
  if (new Set(choices.map(row => row.id)).size !== choices.length) throw invalid();
  return choices.sort((a, b) => Date.parse(b.startedAt ?? b.createdAt) - Date.parse(a.startedAt ?? a.createdAt)
    || a.id.localeCompare(b.id));
}

export function parseProcessingStatus(value: unknown, meetingId: string, sessionId: string): ProcessingStatus {
  const row = object(value), source = object(row.source), saved = object(row.savedResult);
  if (!canonicalId(meetingId) || !canonicalId(sessionId) || row.meetingId !== meetingId || row.sessionId !== sessionId
    || source.meetingId !== meetingId || source.sessionId !== sessionId) throw invalid();
  const tenantId = uuid(source.tenantId);
  if (typeof source.state !== 'string' || !['UNKNOWN', 'AWAITING_CLOSURE', 'QUIESCING', 'FINALIZED', 'FAILED'].includes(source.state)) throw invalid();
  const state = source.state as SourceState, cycleVersion = version(source.cycleVersion), observationRevision = version(source.observationRevision);
  const closure = provenance(source);
  if ((cycleVersion === null) !== (observationRevision === null) || (cycleVersion === null && state !== 'UNKNOWN')
    || (cycleVersion === null && closure.recordingOutcome !== 'UNKNOWN')
    || (closure.recordingOutcome === 'UNKNOWN' && state !== 'UNKNOWN' && state !== 'AWAITING_CLOSURE')
    || ((state === 'QUIESCING' || state === 'FAILED') && (cycleVersion === null || cycleVersion < 1))) throw invalid();
  const failureCode = source.failureCode;
  if (failureCode !== null && (state !== 'FAILED'
    || (failureCode !== 'NO_VALID_SEGMENTS_BEFORE_DEADLINE' && failureCode !== 'INVALID_CANONICAL_SEGMENT'))) throw invalid();
  let finalizedOccurrence: Occurrence | null = null;
  if (source.finalizedOccurrence !== null) {
    const occurrence = object(source.finalizedOccurrence), immutable = provenance(occurrence);
    const finalizationVersion = version(occurrence.finalizationVersion, 1);
    if (state !== 'FINALIZED' || finalizationVersion === null || finalizationVersion !== cycleVersion
      || (immutable.recordingOutcome !== 'UNKNOWN' && (immutable.recordingOutcome !== closure.recordingOutcome
        || immutable.recordingIncompleteReason !== closure.recordingIncompleteReason))) throw invalid();
    finalizedOccurrence = { analysisRunId: uuid(occurrence.analysisRunId), finalizationVersion,
      finalizedAt: instant(occurrence.finalizedAt), ...immutable };
  }
  if ((state === 'FINALIZED') !== (finalizedOccurrence !== null)) throw invalid();
  const observedAt = instant(saved.observedAt);
  let savedResult: ProcessingStatus['savedResult'];
  if (saved.state === 'NOT_FOUND') {
    if (['analysisRunId', 'finalizationVersion', 'finalizedAt', 'recordingOutcome', 'recordingIncompleteReason',
      'matchesCurrentSourceOccurrence'].some(key => saved[key] !== null)) throw invalid();
    savedResult = { state: 'NOT_FOUND', observedAt };
  } else if (saved.state === 'AVAILABLE') {
    const analysisRunId = uuid(saved.analysisRunId), finalizationVersion = version(saved.finalizationVersion, 1);
    const finalizedAt = saved.finalizedAt === null ? null : instant(saved.finalizedAt), immutable = provenance(saved);
    const match = saved.matchesCurrentSourceOccurrence;
    if ((finalizationVersion === null) !== (finalizedAt === null) || (match !== null && typeof match !== 'boolean')) throw invalid();
    let expectedMatch: boolean | null = null;
    if (finalizedOccurrence && (finalizedOccurrence.analysisRunId === analysisRunId
      || finalizedOccurrence.finalizationVersion === finalizationVersion)) {
      if (finalizedOccurrence.analysisRunId !== analysisRunId || finalizedOccurrence.finalizationVersion !== finalizationVersion
        || finalizedOccurrence.finalizedAt !== finalizedAt || finalizedOccurrence.recordingOutcome !== immutable.recordingOutcome
        || finalizedOccurrence.recordingIncompleteReason !== immutable.recordingIncompleteReason) throw invalid();
      expectedMatch = true;
    } else if (finalizationVersion !== null && cycleVersion !== null && finalizationVersion < cycleVersion) expectedMatch = false;
    if (match !== expectedMatch) throw invalid();
    savedResult = { state: 'AVAILABLE', observedAt, analysisRunId, finalizationVersion, finalizedAt,
      matchesCurrentSourceOccurrence: match, ...immutable };
  } else throw invalid();
  return { meetingId, sessionId, source: { tenantId, state, cycleVersion, observationRevision,
    observedAt: instant(source.observedAt), failureCode: failureCode as ProcessingStatus['source']['failureCode'],
    finalizedOccurrence, ...closure }, savedResult };
}

export class ProcessingStatusReadError extends Error {
  constructor(readonly status: number) {
    super(status === 410 ? 'Bu kayıt silinmiş; durumu açılamıyor.'
      : status === 423 ? 'Bu kaydın silinmesi bekliyor; durum bilgisine erişilemiyor.'
        : status === 403 ? 'Bu kaydın durumunu görüntüleme yetkiniz yok.'
          : 'Kayıt durumu şu anda alınamıyor. Bu, kaydedilmiş sonucun bulunmadığı anlamına gelmez.');
  }
}

export function processingStatusMessages(status: ProcessingStatus): string[] {
  const sourceText: Record<SourceState, string> = {
    UNKNOWN: 'Konuşma metninin hazırlık durumu doğrulanamadı.',
    AWAITING_CLOSURE: 'Sunucu bu kaydın kapanışını henüz doğrulamamış.',
    QUIESCING: 'Konuşma metninin hazırlanma adımı henüz tamamlanmamış.',
    FINALIZED: 'Konuşma metninin analiz için kullanılacak sürümü oluşturulmuş.',
    FAILED: 'Konuşma metninin bu hazırlama denemesi başarısız olmuş.',
  };
  const messages = [sourceText[status.source.state]];
  if (status.source.failureCode === 'NO_VALID_SEGMENTS_BEFORE_DEADLINE') messages.push('Belirlenen süre içinde işlenebilir konuşma metni oluşmamış.');
  if (status.source.failureCode === 'INVALID_CANONICAL_SEGMENT') messages.push('Konuşma metninin bir bölümü doğrulanamadığı için hazırlama tamamlanamamış.');
  if (status.source.recordingOutcome === 'INCOMPLETE') messages.push('Bu kayıt eksik kapatılmış; konuşmanın tamamını kapsamayabilir.');
  if (status.savedResult.state === 'NOT_FOUND') messages.push('Bu kayıt için kaydedilmiş analiz sonucu bulunmuyor. Analizin devam edip etmediği bu bilgilerden anlaşılamıyor.');
  else if (status.savedResult.matchesCurrentSourceOccurrence === true) messages.push('Kaydedilmiş analiz sonucu bu metin sürümüyle eşleşiyor.');
  else if (status.savedResult.matchesCurrentSourceOccurrence === false) messages.push('Kaydedilmiş analiz sonucu metnin önceki bir sürümüne ait.');
  else messages.push('Bu kayıt için kaydedilmiş analiz sonucu var; güncel metin sürümüyle eşleşmesi doğrulanamadı.');
  return messages;
}
