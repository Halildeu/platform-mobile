import { parseProcessingStatus, parseRecordingChoices, processingStatusMessages } from '../processingStatus';
import { choices, finalizedWire, meetingId, secondSessionId, sessionId, wireStatus } from '../testFixtures/processingStatus.fixture';

test('keeps unknown, closure waiting and missing saved result independent', () => {
  const waiting = parseProcessingStatus(wireStatus(), meetingId, sessionId);
  expect(processingStatusMessages(waiting)).toEqual([
    'Sunucu bu kaydın kapanışını henüz doğrulamamış.',
    'Bu kayıt için kaydedilmiş analiz sonucu bulunmuyor. Analizin devam edip etmediği bu bilgilerden anlaşılamıyor.',
  ]);
  const unknown = wireStatus(); Object.assign(unknown.source, { state: 'UNKNOWN', cycleVersion: null, observationRevision: null });
  expect(processingStatusMessages(parseProcessingStatus(unknown, meetingId, sessionId))[0]).toContain('doğrulanamadı');
});
test('accepts an exact incomplete occurrence and warns without claiming complete capture', () => {
  const status = parseProcessingStatus(finalizedWire(), meetingId, sessionId);
  expect(status.savedResult).toMatchObject({ matchesCurrentSourceOccurrence: true });
  expect(processingStatusMessages(status)).toContain('Bu kayıt eksik kapatılmış; konuşmanın tamamını kapsamayabilir.');
});
test('accepts legacy unknown immutable provenance and unestablished legacy saved occurrence', () => {
  const row = finalizedWire();
  Object.assign(row.source, { recordingOutcome: 'FINISHED', recordingIncompleteReason: null });
  Object.assign(row.source.finalizedOccurrence, { recordingOutcome: 'UNKNOWN', recordingIncompleteReason: null });
  Object.assign(row.savedResult, { recordingOutcome: 'UNKNOWN', recordingIncompleteReason: null, finalizationVersion: null,
    finalizedAt: null, matchesCurrentSourceOccurrence: null, analysisRunId: secondSessionId });
  expect(parseProcessingStatus(row, meetingId, sessionId).savedResult).toMatchObject({ matchesCurrentSourceOccurrence: null });
});
test.each(['QUIESCING', 'FAILED'])('accepts %s after closure without claiming AI activity', state => {
  const row = wireStatus(); Object.assign(row.source, { state, cycleVersion: 2, recordingOutcome: 'FINISHED',
    failureCode: state === 'FAILED' ? 'INVALID_CANONICAL_SEGMENT' : null });
  expect(parseProcessingStatus(row, meetingId, sessionId).source.state).toBe(state);
});
test('accepts only a strictly older saved version as false', () => {
  const row = finalizedWire(); Object.assign(row.savedResult, { finalizationVersion: 1, matchesCurrentSourceOccurrence: false,
    analysisRunId: '55555555-5555-4555-8555-555555555555' });
  expect(parseProcessingStatus(row, meetingId, sessionId).savedResult).toMatchObject({ matchesCurrentSourceOccurrence: false });
});
test.each([
  ['wrong meeting', (r: ReturnType<typeof wireStatus>) => { r.meetingId = secondSessionId; }],
  ['wrong source session', (r: ReturnType<typeof wireStatus>) => { r.source.sessionId = secondSessionId; }],
  ['state array', (r: ReturnType<typeof wireStatus>) => { Object.assign(r.source, { state: ['UNKNOWN'] }); }],
  ['missing closure', (r: ReturnType<typeof wireStatus>) => { Object.assign(r.source, { recordingOutcome: undefined }); }],
  ['incoherent closure', (r: ReturnType<typeof wireStatus>) => { r.source.recordingOutcome = 'INCOMPLETE'; }],
  ['one missing version', (r: ReturnType<typeof wireStatus>) => { Object.assign(r.source, { cycleVersion: null }); }],
  ['unsafe version', (r: ReturnType<typeof wireStatus>) => { r.source.cycleVersion = Number.MAX_SAFE_INTEGER + 1; }],
  ['unknown failure', (r: ReturnType<typeof wireStatus>) => { Object.assign(r.source, { failureCode: 'private failure' }); }],
  ['final without occurrence', (r: ReturnType<typeof wireStatus>) => { Object.assign(r.source, { state: 'FINALIZED', recordingOutcome: 'FINISHED' }); }],
  ['non-null absent metadata', (r: ReturnType<typeof wireStatus>) => { Object.assign(r.savedResult, { analysisRunId: secondSessionId }); }],
  ['missing absent metadata', (r: ReturnType<typeof wireStatus>) => { Object.assign(r.savedResult, { finalizedAt: undefined }); }],
  ['invalid observed time', (r: ReturnType<typeof wireStatus>) => { r.source.observedAt = 'yesterday'; }],
] as const)('rejects %s', (_label, edit) => {
  const row = wireStatus(); edit(row);
  expect(() => parseProcessingStatus(row, meetingId, sessionId)).toThrow('doğrulanamadı');
});
test.each(['analysisRunId', 'finalizationVersion', 'finalizedAt', 'recordingOutcome'])('rejects false exact-match claim for %s', key => {
  const row = finalizedWire(); Object.assign(row.savedResult, { [key]: key === 'finalizationVersion' ? 1 : key === 'analysisRunId' ? secondSessionId
    : key === 'finalizedAt' ? '2026-09-25T18:47:07Z' : 'UNKNOWN', ...(key === 'recordingOutcome' ? { recordingIncompleteReason: null } : {}) });
  expect(() => parseProcessingStatus(row, meetingId, sessionId)).toThrow();
});
test.each([null, false])('rejects overlapping immutable identities regardless of the match flag (%s)', match => {
  const row = finalizedWire(); Object.assign(row.savedResult, { finalizationVersion: match === null ? null : 1,
    finalizedAt: match === null ? null : row.savedResult.finalizedAt, matchesCurrentSourceOccurrence: match });
  expect(() => parseProcessingStatus(row, meetingId, sessionId)).toThrow();
  Object.assign(row.savedResult, { analysisRunId: secondSessionId, finalizationVersion: 2, finalizedAt: row.source.finalizedOccurrence.finalizedAt });
  expect(() => parseProcessingStatus(row, meetingId, sessionId)).toThrow();
});
test('rejects an unknown match flag for an exact tuple or a provably older version', () => {
  const row = finalizedWire(); Object.assign(row.savedResult, { matchesCurrentSourceOccurrence: null });
  expect(() => parseProcessingStatus(row, meetingId, sessionId)).toThrow();
  Object.assign(row.savedResult, { analysisRunId: secondSessionId, finalizationVersion: 1 });
  expect(() => parseProcessingStatus(row, meetingId, sessionId)).toThrow();
});
test('returns bounded metadata only, sorts choices, and rejects ambiguous scope or duplicate sessions', () => {
  const rows = parseRecordingChoices([{ ...choices[1], recordingUrl: 'secret', subject: 'private' }, choices[0]], meetingId);
  expect(rows).toEqual(choices); expect(rows[1]).not.toHaveProperty('recordingUrl');
  expect(() => parseRecordingChoices([choices[0], choices[0]], meetingId)).toThrow();
  expect(() => parseRecordingChoices([{ ...choices[0], meetingId: secondSessionId }], meetingId)).toThrow();
  expect(() => parseRecordingChoices({ content: choices }, meetingId)).toThrow();
  expect(() => parseRecordingChoices(Array(1001).fill(choices[0]), meetingId)).toThrow();
});
