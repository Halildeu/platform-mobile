export interface AnalysisSnapshot {
  version: number; partial: boolean; summary: string; decisions: string[];
  actions: { text: string; owner: string | null; dueDate: string | null }[];
}
const shortText = (value: unknown): value is string => typeof value === 'string' && value.length <= 20000;

/** Only the server's verified output fields are eligible for display. */
export function parseAnalysis(value: unknown): AnalysisSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (p.grounding_policy !== 'verified_only' || !Number.isSafeInteger(p.version) || (p.version as number) < 0 ||
      typeof p.is_partial !== 'boolean' || !shortText(p.summary) ||
      !Array.isArray(p.decisions) || p.decisions.length > 100 || !p.decisions.every(shortText) ||
      !Array.isArray(p.action_items) || p.action_items.length > 100) return null;
  const actions: AnalysisSnapshot['actions'] = [];
  for (const item of p.action_items) {
    if (!item || typeof item !== 'object' || !shortText(item.text) ||
        !(item.owner == null || shortText(item.owner)) || !(item.due_date == null || shortText(item.due_date))) return null;
    actions.push({ text: item.text, owner: item.owner ?? null, dueDate: item.due_date ?? null });
  }
  return { version: p.version as number, partial: p.is_partial,
    summary: ['verified', 'partial_verified'].includes(String(p.summary_grounding_status)) ? p.summary : '',
    decisions: p.decisions, actions };
}

export function newerAnalysis(previous: AnalysisSnapshot | null, next: AnalysisSnapshot): AnalysisSnapshot {
  if (previous && (next.version < previous.version || (!previous.partial && next.partial))) return previous;
  return next;
}

/** Incremental bounded SSE parser; no transcript or token logging. */
export class AnalysisEvents {
  private carry = '';
  push(chunk: string): AnalysisSnapshot[] {
    this.carry += chunk;
    if (this.carry.length > 262144) { this.carry = ''; throw new Error('Analiz akışı sınırı aşıldı.'); }
    const parts = this.carry.split(/\r?\n\r?\n/);
    this.carry = parts.pop() ?? '';
    const snapshots: AnalysisSnapshot[] = [];
    for (const part of parts) {
      let event = ''; const data: string[] = [];
      for (const line of part.split(/\r?\n/)) {
        const index = line.indexOf(':');
        if (index <= 0) continue;
        const field = line.slice(0, index); const value = line.slice(index + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        if (field === 'data') data.push(value);
      }
      if (event !== 'analysis') continue;
      try { const snapshot = parseAnalysis(JSON.parse(data.join('\n'))); if (snapshot) snapshots.push(snapshot); }
      catch { /* Invalid data never becomes user-visible content. */ }
    }
    return snapshots;
  }
}
