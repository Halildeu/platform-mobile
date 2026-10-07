import type { RecordingProvenance } from './recordingProvenance';

/** Only the selected transcript occurrence; meeting-wide counts are not its provenance. */
export function recordingTranscriptNotices(document: RecordingProvenance): string[] {
  if (document.recordingOutcome === 'INCOMPLETE') {
    return ['Bu metin eksik kapatılan kayıttan alındı; konuşmanın tamamını kapsamayabilir.'];
  }
  if (document.recordingOutcome !== 'FINISHED') {
    return ['Bu kaydın kapanış durumu doğrulanamadı; metin konuşmanın tamamını kapsamayabilir.'];
  }
  return [];
}

/** Export metadata stays outside the body: never store it as source text or speaker offsets. */
export function transcriptText(text: string, document: RecordingProvenance): string {
  const notices = recordingTranscriptNotices(document);
  return notices.length ? `Kayıt bilgisi\n${notices.join('\n')}\n\nKonuşma metni\n${text}` : text;
}
