import { fetch as expoFetch } from 'expo/fetch';
import { subscribeAnalysis } from '../analysisSubscription';
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
const options = () => ({ baseUrl: 'https://example.test', meetingId: '12345678-1234-1234-1234-123456789012',
  token: 'test-only', onSnapshot: jest.fn(), onStatus: jest.fn() });
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
