import { begin, completeCapture, captureStopped, abandonRecording, createMeeting, finish, logout, persistedResult, CONSENT } from '../liveTestApi';
import { mobileSession } from '../../auth/mobileSession';
import * as SecureStore from 'expo-secure-store';
import { createHash } from 'node:crypto';
import { BUFFER_JOURNAL_KEY, BUFFER_LOSS_KEY } from '../nativeBufferJournal';
import * as nativePush from '../../notifications/nativePush';
import { resultExporter } from '../../analysis/nativeResultExport';
jest.mock('../../notifications/nativePush', () => ({ disableNativePush: jest.fn() }));
jest.mock('../../analysis/nativeResultExport', () => ({ resultExporter: { cleanup: jest.fn() } }));
const requestId = '12345678-1234-1234-1234-123456789abc';
const meetingId = '12345678-1234-1234-1234-123456789012';
const claims = { iss: 'https://testai.acik.com/realms/platform-test', sub: 'test-user', companyId: 'test-company' };
const jwt = `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
const ownerHash = createHash('sha256').update(JSON.stringify([claims.iss, claims.sub, claims.companyId, null])).digest('hex');
const key = 'platform-mobile.platform-test.recording-lifecycle.v1';
const startedAt = new Date(1789232900000).toISOString();
const receipt = { ownerHash, meetingId, externalSessionId: 'SES-session-1', startedAt, endedAt: null, version: 2, completion: 'confirmed' };
const linked = { ...receipt, sessionId: requestId, meetingStatus: 'IN_PROGRESS', transcriptStatus: 'PENDING' };
let stored: string | null = null;
let mockAudioStored: string | null = null;
beforeEach(() => {
  stored = JSON.stringify(receipt);
  mockAudioStored = null;
  jest.spyOn(mobileSession, 'valid').mockResolvedValue({ jwt, expiresAt: Date.now() + 60000 });
  jest.spyOn(SecureStore, 'getItemAsync').mockImplementation(async readKey =>
    readKey === key ? stored : readKey === BUFFER_JOURNAL_KEY ? mockAudioStored : null);
  jest.spyOn(SecureStore, 'setItemAsync').mockImplementation(async (writeKey, value) => {
    if (writeKey === BUFFER_JOURNAL_KEY) mockAudioStored = value; else stored = value;
  });
  jest.spyOn(SecureStore, 'deleteItemAsync').mockImplementation(async deleteKey => {
    if (deleteKey === BUFFER_JOURNAL_KEY) mockAudioStored = null; else stored = null;
  });
});
afterEach(() => { jest.restoreAllMocks(); });

it('discloses TEST retention and verifies audio cleanup before logout succeeds', async () => {
  jest.spyOn(nativePush, 'disableNativePush').mockResolvedValue(true);
  jest.spyOn(resultExporter, 'cleanup').mockResolvedValue(undefined);
  jest.spyOn(mobileSession, 'logout').mockResolvedValue(true);

  expect(CONSENT).toContain('en fazla 15 dakika');
  expect(CONSENT).toContain('çıkış yaptığımda silinir');
  const loggedOut = await logout();
  expect(mobileSession.valid).toHaveBeenCalledTimes(1);
  expect(nativePush.disableNativePush).toHaveBeenCalledTimes(1);
  expect(resultExporter.cleanup).toHaveBeenCalledWith(true);
  expect(mobileSession.logout).toHaveBeenCalledTimes(1);
  expect(loggedOut).toBe(true);
});

it.each(['creating', 'ready', 'lost', 'deleting'].flatMap(state => ['finish', 'saved'].map(path => ({ state, path }))))('refuses HTTP finish before durable buffer recovery: %j', async ({ state, path }) => {
  const id = createHash('sha256').update(JSON.stringify([ownerHash, receipt.externalSessionId])).digest('hex');
  const journal = JSON.stringify({ version: 1, records: [{ id, ownerHash, sessionId: receipt.externalSessionId,
    retentionMs: 1000, state, ...(state === 'deleting' ? { outcome: 'lost' } : {}) }] });
  jest.spyOn(SecureStore, 'getItemAsync').mockImplementation(async name => name === BUFFER_JOURNAL_KEY ? journal : name === BUFFER_LOSS_KEY ? null : stored);
  const fetchMock = jest.spyOn(global, 'fetch');
  await expect(path === 'saved' ? persistedResult(meetingId) : finish(jwt, receipt.externalSessionId)).rejects.toThrow('Bekleyen veya eksik');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(stored).toBe(JSON.stringify(receipt));
});

it('unreadable audio journal cannot become implicit permission to finish', async () => {
  jest.spyOn(SecureStore, 'getItemAsync').mockImplementation(async name => {
    if (name === BUFFER_JOURNAL_KEY) throw new Error('locked');
    return stored;
  });
  const fetchMock = jest.spyOn(global, 'fetch');
  await expect(finish(jwt, receipt.externalSessionId)).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
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
    expect(JSON.parse(stored!)).toEqual({ ...receipt, completion: 'unknown' });
    // A second capture must not silently close a live first one.
    await expect(begin(jwt, meetingId)).rejects.toThrow('Etkin kayıt');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => finished } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...linked, endedAt: new Date(finished.finishedAtMs).toISOString() }) } as Response);
    await completeCapture(jwt, 'SES-session-1', true);
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

it('saved refresh replays a lost gateway finish response with the original idempotency key', async () => {
  stored = null;
  const calls = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce(ok({ meetingId, captureId: requestId, consentTextHash: 'sha256:test-hash' }))
    .mockResolvedValueOnce(ok({ sessionId: receipt.externalSessionId, sessionStartMs: Date.parse(startedAt), sttProvider: 'speechmatics', transcriptionMode: 'realtime' }))
    .mockResolvedValueOnce(ok(linked))
    .mockRejectedValueOnce(new Error('gateway response lost'));
  await begin(jwt, meetingId);
  await expect(completeCapture(jwt, receipt.externalSessionId, true)).rejects.toThrow();
  expect(JSON.parse(stored!)).toEqual(receipt); // Drain proof survives; no terminal timestamp yet.
  const endedAt = new Date(finished.finishedAtMs).toISOString();
  calls.mockResolvedValueOnce(ok({ ...finished, alreadyFinished: true }))
    .mockResolvedValueOnce(ok({ ...linked, endedAt }))
    .mockResolvedValueOnce(ok(savedResult));
  await expect(persistedResult(meetingId)).resolves.toMatchObject({ meetingId, analysisRunId: requestId });
  const finishes = calls.mock.calls.filter(([path]) => String(path).endsWith('/finish'));
  expect(finishes).toHaveLength(2);
  expect(finishes[0][1]).toEqual(finishes[1][1]);
  expect(calls.mock.calls.slice(4).map(call => call[1]?.method)).toEqual(['POST', 'PUT', 'GET']);
  expect(stored).toBeNull();
});

it('saved refresh consumes a confirmed drain receipt loaded from device storage', async () => {
  const endedAt = new Date(finished.finishedAtMs).toISOString();
  const calls = jest.spyOn(global, 'fetch').mockResolvedValueOnce(ok(finished))
    .mockResolvedValueOnce(ok({ ...linked, endedAt })).mockResolvedValueOnce(ok(savedResult));
  await expect(persistedResult(meetingId)).resolves.toMatchObject({ meetingId });
  expect(calls.mock.calls.map(call => call[1]?.method)).toEqual(['POST', 'PUT', 'GET']);
  expect(stored).toBeNull();
});

it.each([
  { completion: 'unknown' },
  { completion: 'unknown', endedAt: new Date(finished.finishedAtMs).toISOString() },
  { version: undefined, completion: undefined },
  { completion: 'unknown', abandon: { endedAt: new Date(finished.finishedAtMs).toISOString(), canonical: false } },
])('saved refresh cannot manufacture finish proof from an unresolved receipt: %j', async change => {
  stored = JSON.stringify({ ...receipt, ...change });
  const before = stored;
  const calls = jest.spyOn(global, 'fetch').mockResolvedValue(ok(savedResult));
  await expect(persistedResult(meetingId)).resolves.toMatchObject({ meetingId });
  expect(calls.mock.calls.map(call => call[1]?.method)).toEqual(['GET']);
  expect(stored).toBe(before);
});

it('saved refresh reconciles a legacy terminal receipt by reading only', async () => {
  const endedAt = new Date(finished.finishedAtMs).toISOString();
  stored = JSON.stringify({ ...receipt, version: undefined, completion: undefined, endedAt });
  const calls = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce(ok({ ...linked, endedAt, recordingIncomplete: false }))
    .mockResolvedValueOnce(ok(savedResult));
  await expect(persistedResult(meetingId)).resolves.toMatchObject({ meetingId });
  expect(calls.mock.calls.map(call => call[1]?.method)).toEqual(['GET', 'GET']);
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

const ok = (payload: unknown) => ({ ok: true, json: async () => payload } as Response);
const savedResult = { analysisRunId: requestId, meetingId, sessionId: requestId, generatedAt: startedAt,
  persisted: true, storageMode: 'canonical', summary: '', summary_grounding_status: 'empty',
  decisions: [], action_items: [], citations: [], summary_citations: [] };
const canonicalAbandon = () => ({ ...linked, endedAt: JSON.parse(stored!).abandon.endedAt,
  recordingIncomplete: true, transcriptStatus: 'FAILED' });
const gatewayAbandon = { ...finished, finishedAtMs: Date.now(), finalState: 'ABANDONED' };

it.each([undefined, 2])('never manufactures finish proof from an interrupted receipt v%s', async version => {
  stored = JSON.stringify({ ...receipt, version, completion: version ? 'unknown' : undefined });
  const fetchMock = jest.spyOn(global, 'fetch');
  await expect(finish(jwt, receipt.externalSessionId)).rejects.toThrow('eksiksiz');
  await expect(begin(jwt, meetingId)).rejects.toThrow('eksiksiz');
  expect(fetchMock).not.toHaveBeenCalled(); expect(stored).not.toBeNull();
});

it('legacy endedAt only reconciles an exact already-ended canonical receipt without writes', async () => {
  const endedAt = new Date(finished.finishedAtMs).toISOString();
  stored = JSON.stringify({ ...receipt, version: undefined, completion: undefined, endedAt });
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(ok({ ...linked, endedAt, recordingIncomplete: false }));
  await finish(jwt, receipt.externalSessionId);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1]?.method).toBe('GET'); expect(stored).toBeNull();
});

it.each([{ endedAt: null }, { externalSessionId: 'SES-other' }, { recordingIncomplete: true }, { recordingIncomplete: undefined }])(
  'legacy endedAt never authorizes a new canonical finish when reconciliation differs: %j', async difference => {
    const endedAt = new Date(finished.finishedAtMs).toISOString();
    stored = JSON.stringify({ ...receipt, version: undefined, completion: undefined, endedAt });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(ok({ ...linked, endedAt, recordingIncomplete: false, ...difference }));
    await expect(finish(jwt, receipt.externalSessionId)).rejects.toThrow('eşleşmedi');
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
    expect(stored).not.toBeNull();
  });

it('stopped microphone remains stoppable through a storage read failure without manufacturing proof', async () => {
  stored = null;
  const fetchMock = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce(ok({ meetingId, captureId: requestId, consentTextHash: 'sha256:test-hash' }))
    .mockResolvedValueOnce(ok({ sessionId: receipt.externalSessionId, sessionStartMs: Date.parse(startedAt), sttProvider: 'speechmatics', transcriptionMode: 'realtime' }))
    .mockResolvedValueOnce(ok(linked));
  await begin(jwt, meetingId);
  await expect(finish(jwt, receipt.externalSessionId)).rejects.toThrow('Etkin kayıt');
  captureStopped(receipt.externalSessionId);
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('locked'));
  await expect(completeCapture(jwt, receipt.externalSessionId, true)).rejects.toThrow('okunamadı');
  expect(JSON.parse(stored!).completion).toBe('unknown');
  fetchMock.mockImplementation(async path => String(path).endsWith('/recording-lifecycle/abandon') ? ok(canonicalAbandon()) : ok(gatewayAbandon));
  await abandonRecording(jwt, receipt.externalSessionId);
  expect(stored).toBeNull();
});

it('retains stable abandon intent after a lost canonical response and retries its exact time', async () => {
  stored = JSON.stringify({ ...receipt, completion: 'unknown' });
  const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network'));
  await expect(abandonRecording(jwt, receipt.externalSessionId)).rejects.toThrow('bilinmiyor');
  const intent = JSON.parse(stored!).abandon;
  expect(intent.canonical).toBe(false);
  fetchMock.mockImplementation(async path => String(path).endsWith('/recording-lifecycle/abandon') ? ok(canonicalAbandon()) : ok(gatewayAbandon));
  await abandonRecording(jwt, receipt.externalSessionId);
  expect(fetchMock.mock.calls[0][1]?.body).toBe(fetchMock.mock.calls[1][1]?.body);
  expect(stored).toBeNull();
});

it('canonical acknowledgement survives failed gateway cleanup; retry skips canonical write', async () => {
  stored = JSON.stringify({ ...receipt, completion: 'unknown' });
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ok(canonicalAbandon()))
    .mockRejectedValueOnce(new Error('cleanup response lost'));
  await expect(abandonRecording(jwt, receipt.externalSessionId)).rejects.toThrow('bilinmiyor');
  expect(JSON.parse(stored!).abandon.canonical).toBe(true);
  await expect(finish(jwt, receipt.externalSessionId)).rejects.toThrow('Eksik kayıt');
  fetchMock.mockResolvedValueOnce(ok({ ...gatewayAbandon, alreadyFinished: true }));
  await abandonRecording(jwt, receipt.externalSessionId);
  expect(fetchMock.mock.calls.filter(([path]) => String(path).includes('recording-lifecycle'))).toHaveLength(1);
  expect(fetchMock.mock.calls[1][1]?.headers).toEqual(fetchMock.mock.calls[2][1]?.headers);
  expect(stored).toBeNull();
});

it.each(['AUDIO_GATEWAY_SESSION_NOT_FOUND', 'UNKNOWN'])('only explicit absent gateway receipt can finish cleanup: %s', async code => {
  stored = JSON.stringify({ ...receipt, completion: 'unknown' });
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ok(canonicalAbandon()))
    .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ code }) } as Response);
  if (code === 'UNKNOWN') { await expect(abandonRecording(jwt, receipt.externalSessionId)).rejects.toThrow(); expect(stored).not.toBeNull(); }
  else { await abandonRecording(jwt, receipt.externalSessionId); expect(stored).toBeNull(); }
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('mismatched canonical abandon cannot clear local audio or reach gateway cleanup', async () => {
  stored = JSON.stringify({ ...receipt, completion: 'unknown' });
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => ok({ ...canonicalAbandon(), meetingId: requestId }));
  await expect(abandonRecording(jwt, receipt.externalSessionId)).rejects.toThrow('doğrulanamadı');
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(JSON.parse(stored!).abandon.canonical).toBe(false);
});

it('a successful malformed gateway payload cannot impersonate the explicit not-found acknowledgement', async () => {
  stored = JSON.stringify({ ...receipt, completion: 'unknown' });
  jest.spyOn(global, 'fetch').mockImplementationOnce(async () => ok(canonicalAbandon())).mockResolvedValueOnce(ok({ absent: true }));
  await expect(abandonRecording(jwt, receipt.externalSessionId)).rejects.toThrow('doğrulanamadı');
  expect(JSON.parse(stored!).abandon.canonical).toBe(true);
});


describe('independent meeting recovery journal', () => {
  const secondMeeting = 'aaaaaaaa-1234-1234-1234-123456789012';
  const secondSession = 'SES-new-recording';
  function mockNewSession() {
    return jest.spyOn(global, 'fetch').mockImplementation(async path => {
      if (String(path).endsWith('/consents')) return ok({ meetingId: secondMeeting, captureId: requestId, consentTextHash: 'sha256:test-hash' });
      if (String(path).endsWith('/sessions')) return ok({ sessionId: secondSession, sessionStartMs: Date.parse(startedAt), sttProvider: 'speechmatics', transcriptionMode: 'realtime' });
      if (String(path).includes(secondMeeting) && String(path).endsWith('/recording-lifecycle')) return ok({ ...linked, meetingId: secondMeeting, externalSessionId: secondSession });
      throw new Error('Unexpected mutation of previous recording');
    });
  }
  it('preserves the old unknown receipt across new start/stop and resolves only the requested session', async () => {
    const old = { ...receipt, completion: 'unknown' };
    stored = JSON.stringify(old);
    const calls = mockNewSession();
    await expect(begin(jwt, meetingId)).rejects.toThrow('eksiksiz');
    expect(calls).not.toHaveBeenCalled();
    await expect(begin(jwt, secondMeeting)).resolves.toBe(secondSession);
    expect(JSON.parse(stored!)).toMatchObject({ version: 3, records: [old, { externalSessionId: secondSession, completion: 'unknown' }] });
    captureStopped(secondSession);
    await expect(completeCapture(jwt, secondSession, false)).resolves.toBe(false);
    const snapshot = stored;
    calls.mockImplementation(async (path, options) => {
      if (String(path).includes(`/meetings/${secondMeeting}/recording-lifecycle/abandon`)) {
        const body = JSON.parse(options!.body as string);
        return ok({ ...linked, ...body, meetingId: secondMeeting, recordingIncomplete: true, transcriptStatus: 'FAILED' });
      }
      if (String(path).includes(`/sessions/${secondSession}/abandon`)) return ok({ ...gatewayAbandon, sessionId: secondSession });
      throw new Error('Wrong target');
    });
    await abandonRecording(jwt, secondSession);
    expect(JSON.parse(snapshot!).records[0]).toEqual(old);
    expect(JSON.parse(stored!)).toEqual(old); // Other recording remains, including outcome.
  });
  it('preserves an existing abandonment intent and its timestamp while allocating a different meeting', async () => {
    const old = { ...receipt, completion: 'unknown', abandon: { endedAt: new Date().toISOString(), canonical: true } };
    stored = JSON.stringify(old); mockNewSession();
    await begin(jwt, secondMeeting);
    captureStopped(secondSession);
    expect(JSON.parse(stored!).records[0]).toEqual(old);
  });
  it('rejects capacity and corrupt/foreign journals before any remote allocation', async () => {
    const calls = jest.spyOn(global, 'fetch');
    const records = Array.from({ length: 20 }, (_, i) => ({ ...receipt, externalSessionId: `SES-old-${i}`, completion: 'unknown' }));
    stored = JSON.stringify({ version: 3, records });
    await expect(begin(jwt, secondMeeting)).rejects.toThrow('sınır');
    stored = JSON.stringify({ version: 3, records: [records[0], records[0]] });
    await expect(begin(jwt, secondMeeting)).rejects.toThrow('doğrulanamadı');
    stored = JSON.stringify({ version: 3, records: [{ ...receipt, ownerHash: 'f'.repeat(64) }] });
    await expect(begin(jwt, secondMeeting)).rejects.toThrow('önceki kullanıcı');
    expect(calls).not.toHaveBeenCalled();
  });
  it('allows genuine capture proof to be retried after a transient local read error', async () => {
    stored = null; mockNewSession();
    await begin(jwt, secondMeeting);
    captureStopped(secondSession);
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('locked'));
    await expect(completeCapture(jwt, secondSession, false)).rejects.toThrow('okunamadı');
    await expect(completeCapture(jwt, secondSession, false)).resolves.toBe(false);
    expect(JSON.parse(stored!).completion).toBe('unknown');
  });
  it('retains confirmed drain proof if network token renewal fails, then finishes with a fresh token on retry', async () => {
    stored = null; const calls = mockNewSession();
    await begin(jwt, secondMeeting);
    captureStopped(secondSession);
    jest.mocked(mobileSession.valid).mockRejectedValueOnce(new Error('Temporary refresh failure'));
    await expect(completeCapture(jwt, secondSession, true)).rejects.toThrow('refresh');
    expect(JSON.parse(stored!).completion).toBe('confirmed');
    expect(calls).toHaveBeenCalledTimes(3); // No stale-token finish request.
    const endedAt = new Date(finished.finishedAtMs).toISOString();
    calls.mockResolvedValueOnce(ok({ ...finished, sessionId: secondSession }))
      .mockResolvedValueOnce(ok({ ...linked, meetingId: secondMeeting, externalSessionId: secondSession, endedAt }))
      .mockResolvedValueOnce(ok({ ...savedResult, meetingId: secondMeeting }));
    await expect(persistedResult(secondMeeting)).resolves.toMatchObject({ meetingId: secondMeeting });
    expect(stored).toBeNull();
  });
  it.each([null, new Date(finished.finishedAtMs).toISOString()])('saved refresh cannot close an old confirmed receipt while another microphone is active (end=%s)', async endedAt => {
    stored = JSON.stringify({ ...receipt, endedAt });
    const calls = mockNewSession();
    await begin(jwt, secondMeeting);
    const before = stored;
    calls.mockResolvedValueOnce(ok(savedResult));
    try {
      await expect(persistedResult(meetingId)).resolves.toMatchObject({ meetingId });
      expect(calls.mock.calls.slice(3).map(call => call[1]?.method)).toEqual(['GET']);
      expect(stored).toBe(before);
    } finally { captureStopped(secondSession); }
  });
  it('does not silently skip a later unresolved recording when earlier confirmed metadata is cleared', async () => {
    const endedAt = new Date(finished.finishedAtMs).toISOString();
    const unknown = { ...receipt, externalSessionId: 'SES-unknown', completion: 'unknown' };
    stored = JSON.stringify({ version: 3, records: [{ ...receipt, endedAt }, unknown] });
    const calls = jest.spyOn(global, 'fetch').mockResolvedValue(ok({ ...linked, endedAt }));
    await expect(begin(jwt, meetingId)).rejects.toThrow('eksiksiz');
    expect(calls).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stored!)).toEqual(unknown);
  });
  it('reconciles only the selected meeting while retaining unrelated confirmed and unknown receipts', async () => {
    const endedAt = new Date(finished.finishedAtMs).toISOString();
    const old = [receipt, { ...receipt, externalSessionId: 'SES-unknown', completion: 'unknown' }];
    const selected = { ...receipt, meetingId: secondMeeting, externalSessionId: 'SES-selected-old', endedAt };
    stored = JSON.stringify({ version: 3, records: [...old, selected] });
    const calls = mockNewSession();
    calls.mockResolvedValueOnce(ok({ ...linked, ...selected, sessionId: requestId, meetingStatus: 'COMPLETED' }));
    await expect(begin(jwt, secondMeeting)).resolves.toBe(secondSession);
    expect(calls).toHaveBeenCalledTimes(4); // One selected closure, then consent/session/link.
    expect(calls.mock.calls[0][0]).toContain(`/meetings/${secondMeeting}/recording-lifecycle`);
    expect(JSON.parse(stored!).records.slice(0, 2)).toEqual(old);
    captureStopped(secondSession);
  });
});

it('archived local loss blocks canonical finish even when the active audio journal is empty', async () => {
  const id = createHash('sha256').update(JSON.stringify([ownerHash, receipt.externalSessionId])).digest('hex');
  jest.spyOn(SecureStore, 'getItemAsync').mockImplementation(async name => name === BUFFER_LOSS_KEY
    ? JSON.stringify({ version: 1, owners: { [ownerHash]: [id] } }) : name === key ? stored : null);
  const fetchMock = jest.spyOn(global, 'fetch');
  await expect(finish(jwt, receipt.externalSessionId)).rejects.toThrow('Bekleyen veya eksik');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(stored).toBe(JSON.stringify(receipt));
});
