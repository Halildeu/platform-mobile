import { analysisHtml } from '../exportHtml';
import { analysisMarkdown } from '../exportMarkdown';
import type { PersistedResult } from '../persistedResult';
const result: PersistedResult = { meetingId: 'meeting', analysisRunId: 'run-A', sessionId: 'SES-A', generatedAt: '2026-09-20T00:00:00Z',
  recordingOutcome: 'FINISHED', recordingIncompleteReason: null,
  summary: 'Geçerli A kaydı', decisions: [], actions: [], sources: [], incompleteRecordingCount: 1 };
test('saved result exports warn about another incomplete recording in the same meeting', () => {
  for (const output of [analysisHtml(result), analysisMarkdown(result)]) {
    expect(output).toContain('eksik kapatılan kayıt'); expect(output).toContain('Geçerli A kaydı');
  }
});
test('unknown or zero counts do not invent incomplete sessions', () => {
  for (const incompleteRecordingCount of [undefined, 0]) {
    expect(analysisHtml({ ...result, incompleteRecordingCount })).not.toContain('eksik kapatılan kayıt');
    expect(analysisMarkdown({ ...result, incompleteRecordingCount })).not.toContain('eksik kapatılan kayıt');
  }
});

test('selected incomplete source is qualified in both exports even with zero meeting count', () => {
  const selected: PersistedResult = { ...result, recordingOutcome: 'INCOMPLETE',
    recordingIncompleteReason: 'CLOSURE_UNCONFIRMED', incompleteRecordingCount: 0 };
  for (const output of [analysisHtml(selected), analysisMarkdown(selected)]) {
    expect(output).toContain('Bu sonuç eksik kapatılan kayıttan oluşturuldu');
    expect(output).not.toContain('Bu toplantıda eksik kapatılan kayıt var');
    expect(output).toContain('Geçerli A kaydı');
  }
});

test('unknown provenance is visible without declaring a known incomplete recording', () => {
  const selected: PersistedResult = { ...result, recordingOutcome: 'UNKNOWN', incompleteRecordingCount: 0 };
  for (const output of [analysisHtml(selected), analysisMarkdown(selected)]) {
    expect(output).toContain('Bu kaydın kapanış durumu doğrulanamadı');
    expect(output).not.toContain('eksik kapatılan kayıt');
  }
});
