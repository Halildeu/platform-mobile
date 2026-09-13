export interface PersistedResult {
  analysisRunId: string; meetingId: string; sessionId: string; generatedAt: string;
  summary: string; decisions: string[];
  actions: { text: string; owner: string | null; dueDate: string | null }[];
  sources: { claim: string; text: string; startSec: number | null }[];
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 20000;
const list = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= 1000;

/** Canonical REST output is a different contract from the ephemeral SSE snapshot. */
export function parsePersistedResult(value: unknown, meetingId: string): PersistedResult {
  const invalid = () => new Error('Kalıcı sonuç yanıtı doğrulanamadı; içerik gösterilmedi.');
  if (!value || typeof value !== 'object') throw invalid();
  const p = value as Record<string, unknown>;
  if (!uuid(meetingId) || p.meetingId !== meetingId || !uuid(p.analysisRunId) ||
      p.persisted !== true || p.storageMode !== 'canonical' ||
      typeof p.sessionId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(p.sessionId) ||
      typeof p.generatedAt !== 'string' || !Number.isFinite(Date.parse(p.generatedAt)) ||
      !text(p.summary) || !list(p.decisions) || !p.decisions.every(text) ||
      !list(p.action_items) || !list(p.citations) || !list(p.summary_citations)) throw invalid();
  const actions: PersistedResult['actions'] = p.action_items.map((item) => {
    if (!item || typeof item !== 'object') throw invalid();
    const a = item as Record<string, unknown>;
    if (!text(a.text) || !(a.owner == null || text(a.owner)) || !(a.due_date == null || text(a.due_date))) throw invalid();
    return { text: a.text, owner: a.owner as string | null ?? null, dueDate: a.due_date as string | null ?? null };
  });
  const seen = new Set<string>();
  const sources: PersistedResult['sources'] = [];
  for (const item of [...p.summary_citations, ...p.citations]) {
    if (!item || typeof item !== 'object') throw invalid();
    const c = item as Record<string, unknown>;
    if (!text(c.claim) || !text(c.source_text) || c.grounded !== true || c.status !== 'PASSED' ||
        !(c.start_sec == null || (typeof c.start_sec === 'number' && Number.isFinite(c.start_sec) && c.start_sec >= 0))) throw invalid();
    const key = JSON.stringify([c.claim, c.source_text, c.start_sec]);
    if (!seen.has(key)) sources.push({ claim: c.claim, text: c.source_text, startSec: c.start_sec as number | null ?? null });
    seen.add(key);
  }
  return { analysisRunId: p.analysisRunId, meetingId, sessionId: p.sessionId, generatedAt: p.generatedAt,
    summary: ['verified', 'partial_verified'].includes(String(p.summary_grounding_status)) ? p.summary : '',
    decisions: p.decisions as string[], actions, sources };
}
