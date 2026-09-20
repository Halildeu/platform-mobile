import type { SavedTranscriptDocument } from './savedTranscript';
export type SpeakerKey = { scope: string; speaker: string };
export type SpeakerLabel = SpeakerKey & { name: string };
export type SpeakerLabelEdit = SpeakerKey & { name: string | null; expectedRevision: number };
export type SpeakerLabels = { revision: number; editable: boolean; labels: SpeakerLabel[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const speakerKey = (key: SpeakerKey) => key.scope + ':' + key.speaker;
export function validSpeakerDocument(doc: SavedTranscriptDocument): boolean {
  return uuid.test(doc.meetingId) && uuid.test(doc.analysisRunId) && uuid.test(doc.sessionId ?? '')
    && Number.isSafeInteger(doc.finalizationVersion) && (doc.finalizationVersion ?? 0) > 0
    && /^[a-f0-9]{64}$/.test(doc.transcriptSha256 ?? '');
}
export function normalizeSpeakerName(input: string): string {
  const name = input.replace(/^\p{Zs}+|\p{Zs}+$/gu, '');
  // No control/format characters, unpaired UTF-16 surrogates or paragraph separators.
  const points = Array.from(input);
  if (!name || input.length > 160 || Array.from(name).length > 80 || points.some(char => {
    const cp = char.codePointAt(0)!;
    return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0xd800 && cp <= 0xdfff)
      || cp === 0x2028 || cp === 0x2029 || /\p{Cf}/u.test(char);
  }))
    throw new Error('Ad 1–80 karakter olmalı; satır sonu veya kontrol karakteri içermemeli.');
  return name;
}
export function parseSpeakerLabels(value: unknown, doc: SavedTranscriptDocument): SpeakerLabels {
  if (!validSpeakerDocument(doc) || !object(value) || value.meetingId !== doc.meetingId
    || value.analysisRunId !== doc.analysisRunId || value.sessionId !== doc.sessionId
    || value.finalizationVersion !== doc.finalizationVersion || value.transcriptSha256 !== doc.transcriptSha256
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || typeof value.editable !== 'boolean'
    || !Array.isArray(value.labels) || value.labels.length > 256) throw new Error('Konuşmacı adları kayıtla eşleşmedi.');
  const known = new Set(doc.segments?.flatMap(segment => segment.speakerAttribution?.turns
    .filter(turn => turn.speaker !== 'UU').map(turn => segment.speakerAttribution!.scope + ':' + turn.speaker) ?? []));
  const seen = new Set<string>();
  const labels = value.labels.map(item => {
    if (!object(item) || typeof item.scope !== 'string' || typeof item.speaker !== 'string' || typeof item.name !== 'string'
      || item.name.length > 160) throw new Error('Konuşmacı adı doğrulanamadı.');
    const key = { scope: item.scope, speaker: item.speaker };
    const identity = speakerKey(key);
    if (!known.has(identity) || seen.has(identity) || normalizeSpeakerName(item.name) !== item.name)
      throw new Error('Konuşmacı adı doğrulanamadı.');
    seen.add(identity);
    return { ...key, name: item.name };
  });
  return { revision: value.revision as number, editable: value.editable, labels };
}
