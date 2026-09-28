import type { PersistedResult } from './persistedResult';

/** Keep saved-screen, copy/share and PDF descriptions consistent with the selected result. */
export function recordingResultNotices(result: PersistedResult): string[] {
  if (result.recordingOutcome === 'INCOMPLETE') {
    return ['Bu sonuç eksik kapatılan kayıttan oluşturuldu; konuşmanın tamamını kapsamayabilir.'];
  }
  const notices: string[] = [];
  if (result.recordingOutcome !== 'FINISHED') {
    notices.push('Bu kaydın kapanış durumu doğrulanamadı; sonuç konuşmanın tamamını kapsamayabilir.');
  }
  if (result.incompleteRecordingCount) {
    notices.push('Bu toplantıda eksik kapatılan kayıt var; sonuç konuşmanın tamamını kapsamayabilir.');
  }
  return notices;
}
