import { begin, createMeeting, finish, persistedResult } from '../liveTestApi';
import { mobileSession } from '../../auth/mobileSession';
import * as SecureStore from 'expo-secure-store';
import { createHash } from 'node:crypto';
const requestId = '12345678-1234-1234-1234-123456789abc';
const meetingId = '12345678-1234-1234-1234-123456789012';
const claims = { iss: 'https://testai.acik.com/realms/platform-test', sub: 'test-user', companyId: 'test-company' };
const jwt = `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
const ownerHash = createHash('sha256').update(JSON.stringify([claims.iss, claims.sub, claims.companyId, null])).digest('hex');
const key = 'platform-mobile.platform-test.recording-lifecycle.v1';
const startedAt = new Date(1789232900000).toISOString();
const receipt = { ownerHash, meetingId, externalSessionId: 'SES-session-1', startedAt, endedAt: null };
const linked = { ...receipt, sessionId: requestId, meetingStatus: 'IN_PROGRESS', transcriptStatus: 'PENDING' };
let stored: string | null = null;
beforeEach(() => {
  stored = JSON.stringify(receipt);
  jest.spyOn(SecureStore, 'getItemAsync').mockImplementation(async () => stored);
  jest.spyOn(SecureStore, 'setItemAsync').mockImplementation(async (_key, value) => { stored = value; });
  jest.spyOn(SecureStore, 'deleteItemAsync').mockImplementation(async () => { stored = null; });
});
afterEach(() => { jest.restoreAllMocks(); });
jest.mock('expo-auth-session', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '12345678-1234-1234-1234-123456789abc',
  CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: async (_algorithm: string, value: string) =>
    value.startsWith('[') ? jest.requireActual('node:crypto').createHash('sha256').update(value).digest('hex') : 'test-hash' }));

const finished = {
  sessionId: 'SES-session-1', correlationId: requestId, finalState: 'FINISHED',
  finishedAtMs: 1789233000000, alreadyFinished: false,
};

it.each([false, true])('accepts exact terminal finish acknowledgement (replay=%s)', async (alreadyFinished) => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: true, json: async () => ({ ...finished, alreadyFinished }),
  } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ ...linked, endedAt: new Date(finished.finishedAtMs).toISOString() }) } as Response);
  try {
    await expect(finish(jwt, 'SES-session-1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/sessions\/SES-session-1\/finish$/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST', body: '{}', headers: { 'Idempotency-Key': 'SES-session-1:mobile-finish' },
    });
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT');
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({ externalSessionId: 'SES-session-1', startedAt,
      endedAt: new Date(finished.finishedAtMs).toISOString() });
    expect(stored).toBeNull();
  } finally { fetchMock.mockRestore(); }
});

it.each([
  ['wrong session', { ...finished, sessionId: 'session-2' }],
  ['nonterminal state', { ...finished, finalState: 'FINISHING' }],
  ['missing state', { ...finished, finalState: undefined }],
  ['missing timestamp', { ...finished, finishedAtMs: undefined }],
  ['string timestamp', { ...finished, finishedAtMs: '1789233000000' }],
  ['negative timestamp', { ...finished, finishedAtMs: -1 }],
  ['fractional timestamp', { ...finished, finishedAtMs: 1.5 }],
  ['unsafe timestamp', { ...finished, finishedAtMs: Number.MAX_SAFE_INTEGER + 1 }],
  ['missing replay flag', { ...finished, alreadyFinished: undefined }],
  ['string replay flag', { ...finished, alreadyFinished: 'false' }],
  ['empty response', {}], ['null response', null], ['array response', []],
  ['untrusted text', 'secret-token person@example.com'],
])('rejects %s without retry or response disclosure', async (_name, payload) => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true, json: async () => payload,
  } as Response);
  try {
    await expect(finish(jwt, 'SES-session-1')).rejects.toThrow('Kayıt kapanışı doğrulanamadı.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally { fetchMock.mockRestore(); }
});

it('requests and verifies Speechmatics realtime before starting capture', async () => {
  stored = null;
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: true, json: async () => ({ meetingId, captureId: requestId, consentTextHash: 'sha256:test-hash' }),
  } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ sessionId: 'SES-session-1', sessionStartMs: Date.parse(startedAt), sttProvider: 'speechmatics', transcriptionMode: 'realtime' }) } as Response)
    .mockResolvedValueOnce({ ok: true, json: async () => linked } as Response);
  try {
    await expect(begin(jwt, meetingId)).resolves.toBe('SES-session-1');
    const body = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(body).toMatchObject({ transcriptionMode: 'realtime', audioFormat: 'PCM16', sampleRateHz: 16000, channels: 1 });
    expect(body.sttProvider).toBe('speechmatics');
    expect(fetchMock.mock.calls[2][0]).toBe(`https://testai.acik.com/api/v1/admin/meetings/${meetingId}/recording-lifecycle`);
    expect(fetchMock.mock.calls[2][1]?.method).toBe('PUT');
    expect(JSON.parse(stored!)).toEqual(receipt);
    // A second capture must not silently close a live first one.
    await expect(begin(jwt, meetingId)).rejects.toThrow('Etkin kayıt');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => finished } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...linked, endedAt: new Date(finished.finishedAtMs).toISOString() }) } as Response);
    await finish(jwt, 'SES-session-1');
  } finally { fetchMock.mockRestore(); }
});

it.each([
  { sttProvider: 'internal', transcriptionMode: 'realtime' },
  { sttProvider: 'speechmatics', transcriptionMode: 'balanced' },
  {},
])('rejects an unconfirmed provider/mode without retrying: %j', async (selection) => {
  stored = null;
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: true, json: async () => ({ meetingId, captureId: requestId, consentTextHash: 'sha256:test-hash' }),
  } as Response).mockResolvedValueOnce({ ok: true, json: async () => ({ sessionId: 'SES-session-1', ...selection }) } as Response);
  try {
    await expect(begin(jwt, meetingId)).rejects.toThrow('Speechmatics canlı ses seçimi sunucu tarafından doğrulanmadı');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally { fetchMock.mockRestore(); }
});

it('preserves correlation and stage for an empty consent denial without starting audio', async () => {
  stored = null;
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 403,
    json: async () => { throw new Error('HTML response'); }, headers: new Headers(),
  } as unknown as Response);
  try {
    await expect(begin(jwt, meetingId)).rejects.toThrow(`Takip: ${requestId}`);
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

it('retains confirmed gateway finish through a failed PUT and retries the exact timestamp without finishing twice', async () => {
  const fetchMock = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce({ ok: true, json: async () => finished } as Response)
    .mockRejectedValueOnce(new Error('network lost'));
  await expect(finish(jwt, 'SES-session-1')).rejects.toThrow('Toplantı kayıt bağlantısı');
  const endedAt = new Date(finished.finishedAtMs).toISOString();
  expect(JSON.parse(stored!)).toEqual({ ...receipt, endedAt });
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ...linked, endedAt }) } as Response);
  await expect(finish(jwt, 'SES-session-1')).resolves.toBeUndefined();
  expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'PUT', 'PUT']);
  expect(fetchMock.mock.calls[1][1]?.body).toBe(fetchMock.mock.calls[2][1]?.body);
  expect(stored).toBeNull();
});

it('reconciles a persisted terminal receipt before allowing the next recording attempt', async () => {
  const endedAt = new Date(finished.finishedAtMs).toISOString();
  stored = JSON.stringify({ ...receipt, endedAt });
  const fetchMock = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...linked, endedAt }) } as Response)
    .mockRejectedValueOnce(new Error('offline'));
  await expect(begin(jwt, meetingId)).rejects.toThrow('Kayıt onayı');
  expect(fetchMock.mock.calls[0][1]?.method).toBe('PUT');
  expect(fetchMock.mock.calls[1][0]).toMatch(/\/consents$/);
  expect(stored).toBeNull();
});

it.each(['broken-json', JSON.stringify({ ...receipt, externalSessionId: '../other' }),
  JSON.stringify({ ...receipt, endedAt: 'invalid' })])('fails closed on an invalid durable receipt', async (raw) => {
  stored = raw;
  const fetchMock = jest.spyOn(global, 'fetch');
  await expect(begin(jwt, meetingId)).rejects.toThrow('Bekleyen kayıt bağlantısı');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(stored).toBe(raw);
});

it('rejects account/tenant changes and a different session without sending another owner metadata', async () => {
  const other = `e30.${Buffer.from(JSON.stringify({ ...claims, sub: 'other-user' })).toString('base64url')}.signature`;
  const fetchMock = jest.spyOn(global, 'fetch');
  await expect(begin(other, meetingId)).rejects.toThrow('önceki kullanıcı');
  await expect(finish(jwt, 'SES-other')).rejects.toThrow('Kayıt bağlantısı bulunamadı');
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  { meetingId: requestId }, { externalSessionId: 'SES-other' }, { sessionId: 'not-a-uuid' },
  { startedAt: new Date(Date.parse(startedAt) + 1).toISOString() }, { endedAt: null },
  { meetingStatus: 'SCHEDULED' }, { transcriptStatus: 'UNKNOWN' },
])('does not discard a pending finish on a mismatched canonical acknowledgement: %j', async (delta) => {
  const endedAt = new Date(finished.finishedAtMs).toISOString();
  stored = JSON.stringify({ ...receipt, endedAt });
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ...linked, endedAt, ...delta }) } as Response);
  await expect(finish(jwt, 'SES-session-1')).rejects.toThrow('Toplantı kayıt bağlantısı doğrulanamadı');
  expect(JSON.parse(stored!)).toEqual({ ...receipt, endedAt });
});

it('closes the allocated gateway and never returns a capture session when canonical binding fails', async () => {
  stored = null;
  const fetchMock = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce({ ok: true, json: async () => ({ meetingId, captureId: requestId, consentTextHash: 'sha256:test-hash' }) } as Response)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ sessionId: 'SES-session-1', sessionStartMs: Date.parse(startedAt), sttProvider: 'speechmatics', transcriptionMode: 'realtime' }) } as Response)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ ok: true, json: async () => finished } as Response);
  await expect(begin(jwt, meetingId)).rejects.toThrow('Toplantı kayıt bağlantısı');
  expect(fetchMock.mock.calls.map(call => call[1]?.method)).toEqual(['POST', 'POST', 'PUT', 'POST']);
  expect(fetchMock.mock.calls[3][0]).toMatch(/\/SES-session-1\/finish$/);
  expect(JSON.parse(stored!)).toEqual({ ...receipt, endedAt: new Date(finished.finishedAtMs).toISOString() });
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(key, expect.any(String),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  expect(stored).not.toContain(jwt);
  expect(stored).not.toContain(claims.sub);
});

it('keeps a terminal receipt if canonical synchronization is unauthorized', async () => {
  const endedAt = new Date(finished.finishedAtMs).toISOString();
  stored = JSON.stringify({ ...receipt, endedAt });
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 403,
    json: async () => ({}), headers: new Headers() } as Response);
  await expect(finish(jwt, 'SES-session-1')).rejects.toThrow('403');
  expect(stored).not.toBeNull();
});

it('replays only the persisted finish before reading the same meeting after reopening', async () => {
  const endedAt = new Date(finished.finishedAtMs).toISOString();
  stored = JSON.stringify({ ...receipt, endedAt });
  jest.spyOn(mobileSession, 'valid').mockResolvedValue({ jwt, expiresAt: Date.now() + 60000 });
  const fetchMock = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ...linked, endedAt }) } as Response)
    .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}), headers: new Headers() } as Response);
  await expect(persistedResult(meetingId)).rejects.toThrow('404');
  expect(fetchMock.mock.calls.map(call => call[1]?.method)).toEqual(['PUT', 'GET']);
  expect(fetchMock.mock.calls[1][0]).toMatch(/\/intelligence\/result$/);
  expect(stored).toBeNull();
});

it.each([null, new Date(finished.finishedAtMs).toISOString()])('does not finalize a different meeting while reading a result (end=%s)', async (endedAt) => {
  stored = JSON.stringify({ ...receipt, endedAt });
  const saved = stored;
  jest.spyOn(mobileSession, 'valid').mockResolvedValue({ jwt, expiresAt: Date.now() + 60000 });
  const fetchMock = jest.spyOn(global, 'fetch')
    .mockResolvedValue({ ok: false, status: 404, json: async () => ({}), headers: new Headers() } as Response);
  await expect(persistedResult(requestId)).rejects.toThrow('404');
  expect(fetchMock.mock.calls.map(call => call[1]?.method)).toEqual(['GET']);
  expect(stored).toBe(saved);
});

it('refuses replay when the same subject changes tenant', async () => {
  const other = `e30.${Buffer.from(JSON.stringify({ ...claims, companyId: 'other-company' })).toString('base64url')}.signature`;
  const fetchMock = jest.spyOn(global, 'fetch');
  await expect(finish(other, 'SES-session-1')).rejects.toThrow('önceki kullanıcı');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('sanitizes a device read failure and does not start a new recording', async () => {
  jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValue(new Error('native-private-diagnostic'));
  const fetchMock = jest.spyOn(global, 'fetch');
  await expect(begin(jwt, meetingId)).rejects.toThrow('Bekleyen kayıt bağlantısı cihazdan okunamadı.');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('preserves the receipt if device deletion fails after a valid canonical finish', async () => {
  const endedAt = new Date(finished.finishedAtMs).toISOString();
  stored = JSON.stringify({ ...receipt, endedAt });
  jest.spyOn(SecureStore, 'deleteItemAsync').mockRejectedValue(new Error('native-private-diagnostic'));
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ...linked, endedAt }) } as Response);
  await expect(finish(jwt, 'SES-session-1')).rejects.toThrow('Kayıt bağlantısı temizliği doğrulanamadı.');
  expect(JSON.parse(stored!)).toEqual({ ...receipt, endedAt });
});
