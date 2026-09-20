import { savedSpeakerLabels } from '../liveTestApi';
import { mobileSession } from '../../auth/mobileSession';
import type { SavedTranscriptDocument } from '../../analysis/savedTranscript';
jest.mock('expo-auth-session', () => ({}));
jest.mock('../../auth/mobileSession', () => ({ mobileSession: { valid: jest.fn(), contentScope: jest.fn(() => 1) } }));
jest.mock('../../notifications/nativePush', () => ({ disableNativePush: jest.fn() }));
const id = '11111111-1111-4111-8111-111111111111';
const doc: SavedTranscriptDocument = { meetingId: id, analysisRunId: id, sessionId: id,
  finalizationVersion: 1, transcriptSha256: 'a'.repeat(64), text: 'Test', segments: [{ text: 'Test',
    speakerAttribution: { scope: id, turns: [{ speaker: 'S1', textStart: 0, textEnd: 4, startMs: 0, endMs: 500 }] } }] };
const wire = { meetingId: id, analysisRunId: id, sessionId: id, finalizationVersion: 1,
  transcriptSha256: 'a'.repeat(64), revision: 1, editable: true, labels: [{ scope: id, speaker: 'S1', name: 'Zeynep' }] };
const edit = { scope: id, speaker: 'S1', name: 'Zeynep', expectedRevision: 0 };
beforeEach(() => {
  jest.mocked(mobileSession.contentScope).mockReturnValue(1);
  jest.mocked(mobileSession.valid).mockResolvedValue({ jwt: 'test-token', expiresAt: Date.now() + 100000 });
});
afterEach(() => jest.restoreAllMocks());
test('sends only a one-key CAS edit and validates returned name', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => wire } as Response);
  await expect(savedSpeakerLabels(doc, 1, edit)).resolves.toMatchObject({ revision: 1 });
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: JSON.stringify(edit) });
  expect(fetchMock.mock.calls[0][0]).toContain(`/results/${id}/transcript/speaker-labels`);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...wire, labels: [] }) } as Response);
  await expect(savedSpeakerLabels(doc, 1, edit)).rejects.toThrow('kaydı doğrulanamadı');
});
test('account change while refreshing prevents network write', async () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  jest.mocked(mobileSession.valid).mockImplementationOnce(async () => {
    jest.mocked(mobileSession.contentScope).mockReturnValue(2);
    return { jwt: 'other-account', expiresAt: Date.now() + 100000 };
  });
  await expect(savedSpeakerLabels(doc, 1, edit)).rejects.toThrow('Oturum değişti');
  expect(fetchMock).not.toHaveBeenCalled();
});
test('late response after account change cannot expose names', async () => {
  jest.spyOn(global, 'fetch').mockImplementationOnce(async () => {
    jest.mocked(mobileSession.contentScope).mockReturnValue(2);
    return { ok: true, json: async () => wire } as Response;
  });
  await expect(savedSpeakerLabels(doc, 1)).rejects.toThrow('Oturum değişti');
});
test('a lost write reply is not automatically retried', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('connection lost'));
  await expect(savedSpeakerLabels(doc, 1, edit)).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
