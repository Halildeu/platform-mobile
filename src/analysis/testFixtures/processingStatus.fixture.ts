export const meetingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const sessionId = '11111111-1111-4111-8111-111111111111';
export const secondSessionId = '22222222-2222-4222-8222-222222222222';
export const time = '2026-09-26T18:47:07.257Z';
export const choices = [
  { id: sessionId, meetingId, startedAt: time, createdAt: time },
  { id: secondSessionId, meetingId, startedAt: null, createdAt: '2026-09-25T18:47:07Z' },
];
export function wireStatus(id = sessionId) {
  return { meetingId, sessionId: id, source: {
    tenantId: '33333333-3333-4333-8333-333333333333', meetingId, sessionId: id,
    state: 'AWAITING_CLOSURE', cycleVersion: 0, observationRevision: 1, observedAt: time,
    failureCode: null, recordingOutcome: 'UNKNOWN', recordingIncompleteReason: null,
    finalizedOccurrence: null,
  }, savedResult: { state: 'NOT_FOUND', observedAt: '2026-09-26T18:47:08Z',
    analysisRunId: null, finalizationVersion: null, finalizedAt: null,
    recordingOutcome: null, recordingIncompleteReason: null, matchesCurrentSourceOccurrence: null } };
}
export function finalizedWire() {
  const occurrence = { analysisRunId: '44444444-4444-4444-8444-444444444444', finalizationVersion: 2,
    finalizedAt: time, recordingOutcome: 'INCOMPLETE', recordingIncompleteReason: 'CLOSURE_UNCONFIRMED' };
  return { ...wireStatus(), source: { ...wireStatus().source, state: 'FINALIZED', cycleVersion: 2,
    observationRevision: 9, recordingOutcome: 'INCOMPLETE', recordingIncompleteReason: 'CLOSURE_UNCONFIRMED',
    finalizedOccurrence: occurrence },
  savedResult: { state: 'AVAILABLE', observedAt: time, ...occurrence, matchesCurrentSourceOccurrence: true } };
}
