import { fetch as expoFetch } from 'expo/fetch';
import { subscribeAnalysis } from '../analysisSubscription';
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
const options = () => ({ baseUrl: 'https://example.test', meetingId: '12345678-1234-1234-1234-123456789012',
  token: 'test-only', onSnapshot: jest.fn(), onStatus: jest.fn(), onDiagnostic: jest.fn() });
beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); });
afterEach(() => jest.useRealTimers());

it('does not retry denied access or expose server response content', async () => {
  const args = options();
  jest.mocked(expoFetch).mockResolvedValue({ ok: false, status: 403, body: null } as unknown as Awaited<ReturnType<typeof expoFetch>>);
  const stop = subscribeAnalysis(args);
  await jest.advanceTimersByTimeAsync(60000);
  expect(expoFetch).toHaveBeenCalledTimes(1);
  expect(args.onStatus).toHaveBeenLastCalledWith('Canlı analiz alınamadı (403).');
  stop();
});
it('rejects HTML/login responses instead of claiming a connected analysis stream', async () => {
  const args = options(); const cancel = jest.fn(async () => {});
  jest.mocked(expoFetch).mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'text/html' }, body: { cancel } } as unknown as Awaited<ReturnType<typeof expoFetch>>);
  const stop = subscribeAnalysis(args);
  await jest.advanceTimersByTimeAsync(60000);
  expect(cancel).toHaveBeenCalledTimes(1); expect(expoFetch).toHaveBeenCalledTimes(1);
  expect(args.onStatus).toHaveBeenLastCalledWith(expect.stringContaining('beklenen akış biçiminde değil'));
  stop();
});
it('aborts a hanging handshake and cancels scheduled retry on stop', async () => {
  const args = options();
  jest.mocked(expoFetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const stop = subscribeAnalysis(args);
  await jest.advanceTimersByTimeAsync(15000);
  expect(args.onStatus).toHaveBeenLastCalledWith(expect.stringContaining('15 saniyede yanıt vermedi'));
  stop(); await jest.advanceTimersByTimeAsync(60000);
  expect(expoFetch).toHaveBeenCalledTimes(1);
});

it('delivers a fragmented verified decision and action before stop and reports only metadata', async () => {
  const args = options();
  const wire = ':heartbeat\n\nevent: analysis\ndata: ' + JSON.stringify({
    grounding_policy: 'verified_only', version: 1, is_partial: true,
    summary: '', summary_grounding_status: 'withheld', decisions: ['Onaylandı'],
    action_items: [{ text: 'Sunumu hazırla', owner: 'Zeynep', due_date: 'yarın' }],
  }) + '\n\n';
  const raw = new TextEncoder().encode(wire);
  const cancel = jest.fn(async () => {});
  const releaseLock = jest.fn();
  let readIndex = 0;
  jest.mocked(expoFetch).mockImplementation(async (_url, init) => ({
    ok: true, status: 200, headers: { get: () => 'text/event-stream' },
    body: { getReader: () => ({ cancel, releaseLock, read: () => {
      readIndex++;
      if (readIndex === 1) return Promise.resolve({ done: false, value: raw.slice(0, 36) });
      if (readIndex === 2) return Promise.resolve({ done: false, value: raw.slice(36) });
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    } }) },
  }) as unknown as Awaited<ReturnType<typeof expoFetch>>);
  const stop = subscribeAnalysis(args);
  await jest.advanceTimersByTimeAsync(0);
  expect(args.onSnapshot).toHaveBeenCalledWith(expect.objectContaining({
    decisions: ['Onaylandı'], actions: [{ text: 'Sunumu hazırla', owner: 'Zeynep', dueDate: 'yarın' }],
  }));
  expect(cancel).not.toHaveBeenCalled();
  stop();
  await jest.advanceTimersByTimeAsync(0);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(args.onDiagnostic).toHaveBeenLastCalledWith(expect.stringContaining(`bayt=${raw.byteLength}, heartbeat=1, geçerli=1`));
  expect(JSON.stringify(args.onDiagnostic.mock.calls)).not.toMatch(/Zeynep|Onaylandı|test-only/);
  expect(expoFetch).toHaveBeenCalledTimes(1);
});

it('distinguishes rejected analysis from an open stream without results', async () => {
  const args = options();
  const raw = new TextEncoder().encode(':heartbeat\n\nevent: analysis\ndata: {"grounding_policy":"unchecked","secret":"private"}\n\n');
  const read = jest.fn().mockResolvedValueOnce({ done: false, value: raw }).mockResolvedValue({ done: true });
  jest.mocked(expoFetch).mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'text/event-stream' },
    body: { getReader: () => ({ read, cancel: jest.fn(async () => {}), releaseLock: jest.fn() }) },
  } as unknown as Awaited<ReturnType<typeof expoFetch>>);
  const stop = subscribeAnalysis(args);
  await jest.advanceTimersByTimeAsync(0);
  expect(args.onSnapshot).not.toHaveBeenCalled();
  expect(args.onStatus).toHaveBeenCalledWith(expect.stringContaining('beklenen biçime uymayan'));
  expect(args.onDiagnostic).toHaveBeenCalledWith(expect.stringContaining('geçerli=0, bozuk JSON=0, sözleşmeye uymayan=1'));
  expect(JSON.stringify(args.onDiagnostic.mock.calls)).not.toMatch(/private|unchecked|test-only/);
  stop();
});
