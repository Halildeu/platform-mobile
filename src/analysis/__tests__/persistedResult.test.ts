import { parsePersistedResult } from '../persistedResult';
const id = '12345678-1234-1234-1234-123456789012';
const response = { meetingId: id, analysisRunId: id, sessionId: 'SES-1', generatedAt: '2026-09-10T12:00:00Z',
  persisted: true, storageMode: 'canonical', summary: 'Özet', summary_grounding_status: 'verified',
  decisions: ['Karar'], action_items: [{ text: 'Görev', owner: null, due_date: null }], citations: [], summary_citations: [] };
test('reads canonical REST without inventing SSE version or grounding policy fields', () => {
  expect(parsePersistedResult(response, id)).toMatchObject({ summary: 'Özet', sessionId: 'SES-1', actions: [{ text: 'Görev', owner: null, dueDate: null }] });
});
test('rejects another meeting, ephemeral output, and malformed data', () => {
  for (const change of [{ meetingId: 'other' }, { persisted: false }, { storageMode: 'memory' }, { generatedAt: 'invalid' }, { action_items: [{}] }]) {
    expect(() => parsePersistedResult({ ...response, ...change }, id)).toThrow('doğrulanamadı');
  }
});
test('withholds unverified summary and refuses invalid source evidence', () => {
  expect(parsePersistedResult({ ...response, summary_grounding_status: 'withheld' }, id).summary).toBe('');
  expect(() => parsePersistedResult({ ...response, citations: [{ claim: 'Karar', source_text: 'Kaynak', grounded: false, status: 'FAILED' }] }, id)).toThrow();
});
