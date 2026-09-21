import { readSpeakerAttributionForDuration, SpeakerNumbering, type SpeakerAttribution } from '../transcript/speakerAttribution';

export type SavedTranscriptSegment = { text: string | null; speakerAttribution?: SpeakerAttribution };
export type SavedTranscriptDocument = {
  meetingId: string; analysisRunId: string; text: string; segments?: SavedTranscriptSegment[];
  sessionId?: string; finalizationVersion?: number; transcriptSha256?: string;
};
export type SavedTranscriptRow = { text: string; speaker?: number | 'unknown'; speakerKey?: { scope: string; speaker: string } };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function parseSavedTranscript(value: unknown, meetingId: string, analysisRunId: string): SavedTranscriptDocument {
  if (!object(value)) throw new Error('Konuşma metni doğrulanamadı.');
  const p = value as Record<string, unknown>;
  if (p.meetingId !== meetingId || p.analysisRunId !== analysisRunId ||
      typeof p.transcript !== 'string' || p.transcript.length > 5000000 ||
      typeof p.transcriptSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(p.transcriptSha256))
    throw new Error('Konuşma metni seçilen sonuçla eşleşmiyor.');
  const text = p.transcript;
  return { meetingId, analysisRunId, text, segments: readSegments(p, text),
    sessionId: typeof p.sessionId === 'string' ? p.sessionId : undefined,
    finalizationVersion: typeof p.finalizationVersion === 'number' ? p.finalizationVersion : undefined,
    transcriptSha256: p.transcriptSha256 };
}

/** An older server or an invalid optional projection must not hide the canonical full text. */
function readSegments(p: Record<string, unknown>, transcript: string): SavedTranscriptSegment[] | undefined {
  if (!Array.isArray(p.segments) || !p.segments.length || p.segments.length > 20000 ||
      p.segmentCount !== p.segments.length) return;
  const segments: SavedTranscriptSegment[] = [];
  let textLength = 0;
  let remainingTurns = 30000;
  for (const item of p.segments) {
    if (!object(item) || (item.text !== null && typeof item.text !== 'string') ||
        typeof item.start !== 'number' || !Number.isFinite(item.start) || item.start < 0 ||
        (item.end !== null && (typeof item.end !== 'number' || !Number.isFinite(item.end) || item.end < item.start))) return;
    if (typeof item.text === 'string') {
      textLength += item.text.length;
      if (textLength > transcript.length) return;
    }
    const durationMs = typeof item.end === 'number' && item.end > item.start
      ? Math.floor((item.end - item.start) * 1000 + 0.000001) : -1;
    const attribution = item.speakerAttribution;
    const turnCount = object(attribution) && Array.isArray(attribution.turns) ? attribution.turns.length : 1;
    // Bound allocation before the validator clones turns, not after the whole response.
    remainingTurns -= Math.max(1, turnCount);
    if (remainingTurns < 0) return;
    segments.push({ text: item.text as string | null, speakerAttribution: typeof item.text === 'string'
      ? readSpeakerAttributionForDuration(attribution, item.text, durationMs) : undefined });
  }
  if (segments.filter(item => item.text !== null).map(item => item.text).join('\n') !== transcript) return;
  // Bound rendering work separately from text length (many tiny turns).
  if (segments.reduce((sum, item) => sum + (item.speakerAttribution?.turns.length ?? 1), 0) > 30000) return;
  return segments;
}

/** Pre-number in canonical order, never FlatList mount/scroll order. Each occurrence starts anew. */
export function savedTranscriptRows(document: SavedTranscriptDocument): SavedTranscriptRow[] {
  return savedTranscriptTurns(document).flatMap(row =>
    (row.text.match(/[\s\S]{1,2000}/gu) ?? []).map(text => ({ ...row, text })));
}

/** Logical source turns before viewport chunking; chunk boundaries carry no speaker meaning. */
export function savedTranscriptTurns(document: SavedTranscriptDocument): SavedTranscriptRow[] {
  const chunks = (text: string, speaker?: number | 'unknown'): SavedTranscriptRow[] => text ? [{ text, speaker }] : [];
  if (!document.segments?.some(item => item.speakerAttribution)) return chunks(document.text);
  const numbers = new SpeakerNumbering();
  const rows: SavedTranscriptRow[] = [];
  let hasText = false;
  for (const segment of document.segments) {
    if (segment.text === null) continue;
    const text = segment.text;
    const prefix = hasText ? '\n' : '';
    hasText = true;
    if (!segment.speakerAttribution) { rows.push(...chunks(prefix + text)); continue; }
    const { scope, turns } = segment.speakerAttribution;
    turns.forEach((turn, index) => {
      const from = index === 0 ? 0 : turns[index - 1].textEnd;
      const end = index === turns.length - 1 ? text.length : turn.textEnd;
      const speaker = numbers.number(scope, turn.speaker) ?? 'unknown';
      rows.push(...chunks((index === 0 ? prefix : '') + text.slice(from, end), speaker)
        .map(row => speaker === 'unknown' ? row : { ...row, speakerKey: { scope, speaker: turn.speaker } }));
    });
  }
  return rows;
}
