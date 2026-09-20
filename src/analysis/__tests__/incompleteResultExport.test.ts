import { analysisHtml } from '../exportHtml';
import { analysisMarkdown } from '../exportMarkdown';
import type { PersistedResult } from '../persistedResult';
const result: PersistedResult = { meetingId: 'meeting', analysisRunId: 'run-A', sessionId: 'SES-A', generatedAt: '2026-09-20T00:00:00Z',
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
