/** Backend common-meeting-events/SpeakerAttribution: anonymous, UTF-16 spans. */
export type SpeakerTurn = { speaker: string; textStart: number; textEnd: number; startMs: number; endMs: number };
export type SpeakerAttribution = { scope: string; turns: SpeakerTurn[] };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const splitSurrogate = (text: string, offset: number) => offset > 0 && offset < text.length &&
  /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]);

/** Invalid optional metadata must not discard otherwise usable transcript text. */
export function readSpeakerAttribution(value: unknown, text: string, startSample: unknown, endSample: unknown): SpeakerAttribution | undefined {
  if (!Number.isSafeInteger(startSample) || !Number.isSafeInteger(endSample) ||
      (startSample as number) < 0 || (endSample as number) <= (startSample as number)) return;
  const durationMs = Math.floor(((endSample as number) - (startSample as number)) / 16);
  return readSpeakerAttributionForDuration(value, text, durationMs);
}

/** Saved canonical windows expose seconds, without PCM sequence/sample identifiers. */
export function readSpeakerAttributionForDuration(value: unknown, text: string, durationMs: number): SpeakerAttribution | undefined {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) return;
  if (!object(value) || Object.keys(value).length !== 2 || typeof value.scope !== 'string' || !uuid.test(value.scope) ||
      !Array.isArray(value.turns) || !value.turns.length || value.turns.length > 512) return;
  const turns: SpeakerTurn[] = [];
  let previousEnd = 0;
  for (const item of value.turns) {
    if (!object(item) || Object.keys(item).length !== 5 ||
        typeof item.speaker !== 'string' || !/^(S[1-9][0-9]{0,2}|SPEAKER_[0-9]{2,3}|UU)$/.test(item.speaker) ||
        !['textStart', 'textEnd', 'startMs', 'endMs'].every(key => Number.isSafeInteger(item[key]))) return;
    const { speaker } = item;
    const textStart = item.textStart as number, textEnd = item.textEnd as number;
    const startMs = item.startMs as number, endMs = item.endMs as number;
    if (textStart < previousEnd || textEnd <= textStart || textEnd > text.length ||
        startMs < 0 || endMs < startMs || endMs > durationMs ||
        splitSurrogate(text, textStart) || splitSurrogate(text, textEnd) || text.slice(previousEnd, textStart).trim()) return;
    turns.push({ speaker, textStart, textEnd, startMs, endMs });
    previousEnd = textEnd;
  }
  if (text.slice(previousEnd).trim()) return;
  return { scope: value.scope.toLowerCase(), turns };
}

/** One mounted transcript view; a new scope never reuses a previous identity. */
export class SpeakerNumbering {
  private readonly numbers = new Map<string, number>();
  number(scope: string, speaker: string): number | undefined {
    if (speaker === 'UU') return;
    const key = scope + ':' + speaker;
    if (!this.numbers.has(key)) this.numbers.set(key, this.numbers.size + 1);
    return this.numbers.get(key);
  }
}
