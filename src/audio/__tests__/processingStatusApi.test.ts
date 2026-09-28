import { processingStatus, recordingChoices } from '../liveTestApi';
import { mobileSession } from '../../auth/mobileSession';
import * as SecureStore from 'expo-secure-store';
import { choices, meetingId, secondSessionId, sessionId, wireStatus } from '../../analysis/testFixtures/processingStatus.fixture';
jest.mock('expo-auth-session', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
beforeEach(() => {
  jest.spyOn(mobileSession, 'contentScope').mockReturnValue(1);
  jest.spyOn(mobileSession, 'valid').mockResolvedValue({ jwt: 'synthetic', expiresAt: Date.now() + 60000 });
  jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValue(new Error('Recording journal must not be read'));
  jest.spyOn(SecureStore, 'setItemAsync').mockRejectedValue(new Error('Recording journal must not be changed'));
  jest.spyOn(SecureStore, 'deleteItemAsync').mockRejectedValue(new Error('Recording journal must not be cleared'));
});
afterEach(() => { jest.restoreAllMocks(); });
test('metadata reads are exact-session GETs independent of pending recording closure and storage', async () => {
  const fetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => choices } as Response)
    .mockResolvedValueOnce({ ok: true, json: async () => wireStatus() } as Response);
  expect(await recordingChoices(meetingId, 1)).toEqual(choices);
  expect((await processingStatus(meetingId, sessionId, 1)).savedResult.state).toBe('NOT_FOUND');
  expect(fetch.mock.calls.map(row => row[0])).toEqual([
    `https://testai.acik.com/api/v1/admin/meetings/${meetingId}/sessions`,
    `https://testai.acik.com/api/v1/admin/meetings/${meetingId}/sessions/${sessionId}/processing-status`,
  ]);
  for (const [, options] of fetch.mock.calls) {
    expect(options?.method).toBe('GET'); expect(options?.body).toBeUndefined();
  }
  expect(SecureStore.getItemAsync).not.toHaveBeenCalled(); expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
});
test.each([403, 404, 409, 410, 423, 503])('HTTP %s is a failed read, never NOT_FOUND, and error bodies are not disclosed', async code => {
  const json = jest.fn(async () => ({ secret: 'private' }));
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: code, json } as unknown as Response);
  await expect(processingStatus(meetingId, sessionId, 1)).rejects.toMatchObject({ status: code });
  expect(json).not.toHaveBeenCalled();
});
test('a legacy server 404 cannot masquerade as a missing saved analysis', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);
  await expect(processingStatus(meetingId, sessionId, 1)).rejects.toThrow('bulunmadığı anlamına gelmez');
});
test('wrong session response is rejected rather than falling back to latest meeting result', async () => {
  const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => wireStatus(secondSessionId) } as Response);
  await expect(processingStatus(meetingId, sessionId, 1)).rejects.toThrow('doğrulanamadı');
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('scope change while authenticating prevents the request', async () => {
  jest.mocked(mobileSession.valid).mockImplementation(async () => {
    jest.mocked(mobileSession.contentScope).mockReturnValue(2);
    return { jwt: 'other', expiresAt: Date.now() + 60000 };
  });
  const fetch = jest.spyOn(global, 'fetch');
  await expect(processingStatus(meetingId, sessionId, 1)).rejects.toThrow('Oturum');
  expect(fetch).not.toHaveBeenCalled();
});
test('scope change while fetching prevents a response from returning', async () => {
  jest.spyOn(global, 'fetch').mockImplementation(async () => {
    jest.mocked(mobileSession.contentScope).mockReturnValue(2);
    return { ok: true, json: async () => choices } as Response;
  });
  await expect(recordingChoices(meetingId, 1)).rejects.toThrow('Oturum');
});
test('gateway aliases and invalid meeting paths are rejected without fetching', async () => {
  const fetch = jest.spyOn(global, 'fetch');
  await expect(processingStatus(meetingId, 'SES-not-canonical', 1)).rejects.toThrow('Geçersiz');
  await expect(recordingChoices('../other', 1)).rejects.toThrow('Geçersiz');
  expect(fetch).not.toHaveBeenCalled();
});
