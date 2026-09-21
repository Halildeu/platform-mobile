import { savedTranscriptRows, savedTranscriptTurns, type SavedTranscriptDocument, type SavedTranscriptRow } from './savedTranscript';

/** Only segment line separators change. Words, numbers and existing spaces are not corrected. */
export function readableTranscriptText(text: string): string {
  return text.replace(/(?:\r\n|[\r\n])(?:[ \t]*(?:\r\n|[\r\n]))*/g, (separator, offset: number) => {
    if ((separator.match(/\r\n|[\r\n]/g) ?? []).length > 1) return separator;
    const before = text[offset - 1], after = text.slice(offset + separator.length);
    if (/[ \t]/.test(before ?? '') || /^[ \t]/.test(after)) return '';
    // Join standalone punctuation, but do not turn e.g. "3\n.14" into a decimal.
    if (/^[,.;:!?…]+(?:\s|$)/u.test(after)) return '';
    return ' ';
  });
}

function chunks(row: SavedTranscriptRow): SavedTranscriptRow[] {
  const characters = Array.from(row.text), result: SavedTranscriptRow[] = [];
  for (let start = 0; start < characters.length;) {
    let end = Math.min(start + 2000, characters.length);
    if (end < characters.length) {
      let boundary = end;
      while (boundary > start && !/\s/u.test(characters[boundary - 1])) boundary--;
      if (boundary > start) end = boundary;
    }
    result.push({ ...row, text: characters.slice(start, end).join('') });
    start = end;
  }
  return result;
}

export type TranscriptPresentation = { text: string; rows: SavedTranscriptRow[] };

/** A view/export projection. Never pass this text back to source offsets, hashes or label APIs. */
export function presentSavedTranscript(document: SavedTranscriptDocument, original = false): TranscriptPresentation {
  if (original) return { text: document.text, rows: savedTranscriptRows(document) };
  if (!document.segments?.some(segment => segment.speakerAttribution)) {
    const text = readableTranscriptText(document.text);
    return { text, rows: chunks({ text }) };
  }
  const rows: SavedTranscriptRow[] = [];
  const redactions = new Set<number>();
  let sourceOffset = 0, hasText = false, redacted = false;
  for (const segment of document.segments) {
    if (segment.text === null) { redacted = true; continue; }
    if (redacted) redactions.add(sourceOffset);
    sourceOffset += (hasText ? 1 : 0) + segment.text.length;
    hasText = true; redacted = false;
  }
  let group: SavedTranscriptRow | undefined;
  let parts: string[] = [];
  function flush() {
    if (!group) return;
    const source = parts.join('');
    // Keep speaker/unknown boundaries in both the list and its complete export.
    const prefix = rows.length ? source.match(/^(?:\r\n|[\r\n])+/)?.[0] ?? '\n' : '';
    const body = rows.length ? source.replace(/^(?:\r\n|[\r\n])+/, '') : source;
    const suffix = body.match(/(?:(?:\r\n|[\r\n])[ \t]*)+$/)?.[0] ?? '';
    rows.push(...chunks({ ...group, text: prefix + readableTranscriptText(suffix ? body.slice(0, -suffix.length) : body) + suffix }));
  }
  sourceOffset = 0;
  for (const row of savedTranscriptTurns(document)) {
    const previous = parts.at(-1) ?? '';
    const tail = previous.match(/(?:(?:\r\n|[\r\n])[ \t]*)+$/)?.[0] ?? '';
    const head = row.text.match(/^(?:[ \t]*(?:\r\n|[\r\n]))+/)?.[0] ?? '';
    const paragraphBoundary = ((tail + head).match(/\r\n|[\r\n]/g) ?? []).length > 1;
    const sameSpeaker = group?.speakerKey && row.speakerKey
      && group.speakerKey.scope === row.speakerKey.scope && group.speakerKey.speaker === row.speakerKey.speaker;
    if (!sameSpeaker || paragraphBoundary || redactions.has(sourceOffset)) {
      flush(); group = row; parts = [];
    }
    parts.push(row.text);
    sourceOffset += row.text.length;
  }
  flush();
  return { text: rows.map(row => row.text).join(''), rows };
}
