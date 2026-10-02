import { parsePersistedResult } from '../persistedResult';
const id = '12345678-1234-1234-1234-123456789012';
const response = { meetingId: id, analysisRunId: id, sessionId: 'SES-1', generatedAt: '2026-09-10T12:00:00Z',
  persisted: true, storageMode: 'canonical', summary: 'Özet', summary_grounding_status: 'verified',
  decisions: ['Karar'], action_items: [{ text: 'Görev', owner: null, due_date: null }], citations: [], summary_citations: [] };
test('reads canonical REST without inventing SSE version or grounding policy fields', () => {
  expect(parsePersistedResult(response, id)).toMatchObject({ summary: 'Özet', sessionId: 'SES-1', actions: [{ text: 'Görev', owner: null, dueDate: null }],
    recordingOutcome: 'UNKNOWN', recordingIncompleteReason: null });
});

test.each([
  { recordingOutcome: 'UNKNOWN' }, { recordingOutcome: 'UNKNOWN', recordingIncompleteReason: null },
  { recordingOutcome: 'FINISHED' }, { recordingOutcome: 'FINISHED', recordingIncompleteReason: null },
  { recordingOutcome: 'INCOMPLETE', recordingIncompleteReason: 'CLOSURE_UNCONFIRMED' },
])('retains the authoritative selected-result closure: %p', fields => {
  const parsed = parsePersistedResult({ ...response, ...fields }, id);
  expect(parsed.recordingOutcome).toBe(fields.recordingOutcome);
  expect(parsed.recordingIncompleteReason).toBe(fields.recordingIncompleteReason ?? null);
});

test.each([
  { recordingOutcome: null }, { recordingOutcome: undefined }, { recordingOutcome: 1 },
  { recordingOutcome: 'COMPLETE' }, { recordingOutcome: 'INCOMPLETE' },
  { recordingOutcome: 'INCOMPLETE', recordingIncompleteReason: null },
  { recordingOutcome: 'INCOMPLETE', recordingIncompleteReason: 'OTHER' },
  { recordingOutcome: 'FINISHED', recordingIncompleteReason: 'CLOSURE_UNCONFIRMED' },
  { recordingOutcome: 'UNKNOWN', recordingIncompleteReason: 'CLOSURE_UNCONFIRMED' },
  { recordingOutcome: 'UNKNOWN', recordingIncompleteReason: undefined },
  { recordingIncompleteReason: 'CLOSURE_UNCONFIRMED' }, { recordingIncompleteReason: null },
  { recordingIncompleteReason: undefined },
])('withholds results with malformed closure evidence: %p', fields => {
  expect(() => parsePersistedResult({ ...response, ...fields }, id)).toThrow('doğrulanamadı');
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

test('incomplete reason must belong to the received object', () => {
  const inherited = Object.assign(Object.create({ recordingIncompleteReason: 'CLOSURE_UNCONFIRMED' }),
    response, { recordingOutcome: 'INCOMPLETE' });
  expect(() => parsePersistedResult(inherited, id)).toThrow('doğrulanamadı');
});

test('keeps incomplete-session scope across selection of a different result', () => {
  expect(parsePersistedResult({ ...response, incompleteRecordingCount: 2 }, id).incompleteRecordingCount).toBe(2);
  expect(parsePersistedResult(response, id).incompleteRecordingCount).toBeUndefined();
  for (const value of [-1, 1.5, '1', null]) {
    expect(() => parsePersistedResult({ ...response, incompleteRecordingCount: value }, id)).toThrow();
  }
});
