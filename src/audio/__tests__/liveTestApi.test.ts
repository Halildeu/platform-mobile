import { begin, createMeeting } from '../liveTestApi';
const requestId = '12345678-1234-1234-1234-123456789abc';
jest.mock('expo-auth-session', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '12345678-1234-1234-1234-123456789abc',
  CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: async () => 'test-hash' }));

it('requests realtime mode instead of the server balanced default', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: true, json: async () => ({ meetingId: 'meeting-1', captureId: requestId, consentTextHash: 'sha256:test-hash' }),
  } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ sessionId: 'session-1' }) } as Response);
  try {
    await expect(begin('fake-token', 'meeting-1')).resolves.toBe('session-1');
    const body = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(body).toMatchObject({ transcriptionMode: 'realtime', audioFormat: 'PCM16', sampleRateHz: 16000, channels: 1 });
    expect(body.sttProvider).toBeUndefined();
  } finally { fetchMock.mockRestore(); }
});

it('preserves correlation and stage for an empty consent denial without starting audio', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 403,
    json: async () => { throw new Error('HTML response'); }, headers: new Headers(),
  } as unknown as Response);
  try {
    await expect(begin('secret-token', 'meeting-1')).rejects.toThrow(`Takip: ${requestId}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'X-Correlation-Id': requestId });
  } finally { fetchMock.mockRestore(); }
});

it('redacts network errors and keeps the uncertain write outcome explicit', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('secret-token person@example.com'));
  try {
    const error = await createMeeting('secret-token', 'Toplantı').catch(value => value as Error);
    if (!(error instanceof Error)) throw new Error('Expected request failure');
    expect(error.message).toContain('Yeni toplantı oluşturma');
    expect(error.message).toContain('tamamlanıp tamamlanmadığı bilinmiyor');
    expect(error.message).toContain(`Takip: ${requestId}`);
    expect(error.message).toContain('UTC:');
    expect(error.message).not.toContain('secret-token');
    expect(error.message).not.toContain('@');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally { fetchMock.mockRestore(); }
});

it('creates with title only and leaves tenant and organizer to the server', async () => {
  const meeting = { id: '12345678-1234-1234-1234-123456789012', title: 'Yeni toplantı' };
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => meeting } as Response);
  try {
    await expect(createMeeting('test-token', ' Yeni toplantı ')).resolves.toEqual(meeting);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/admin\/meetings$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ title: 'Yeni toplantı' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally { fetchMock.mockRestore(); }
});

it('rejects blank titles without a request and never automatically retries a failed create', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network failed'));
  try {
    await expect(createMeeting('test-token', ' ')).rejects.toThrow('Toplantı adı');
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(createMeeting('test-token', 'Toplantı')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally { fetchMock.mockRestore(); }
});
