import { replayPendingAudio } from '../pendingAudioReplay';
import { InMemoryChunkStore, OfflineAudioBuffer } from '../offlineBuffer';
import type { LiveSocket } from '../foregroundStream';

const chunk = (seq: number) => ({ chunkSeq: seq, capturedAtMs: 120 + seq, pcm16: new Uint8Array([seq, 2]) });
function socket() {
  const ws: LiveSocket = { readyState: 1, bufferedAmount: 0, onopen: null, onmessage: null,
    onerror: null, onclose: null, send: jest.fn(), close: jest.fn() };
  return { ws, event: (value: object) => ws.onmessage?.({ data: JSON.stringify(value) }) };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('replays exact existing nonzero sequences with gaps, bytes and timestamps without re-enqueue', async () => {
  const store = new InMemoryChunkStore();
  const buffer = new OfflineAudioBuffer({ store, ttlMs: 10000 });
  buffer.enqueue(chunk(8)); buffer.enqueue(chunk(10)); // 9 may already have a receipt.
  const original = store.list(); const enqueue = jest.spyOn(buffer, 'enqueue');
  const io = socket(); const attempt = replayPendingAudio(io.ws, buffer);
  expect(io.ws.send).not.toHaveBeenCalled();
  io.event({ type: 'ready' }); await jest.advanceTimersByTimeAsync(250);
  const frames = jest.mocked(io.ws.send).mock.calls.map(([value]) => value as ArrayBuffer);
  expect(frames.map(value => Number(new DataView(value).getBigInt64(1)))).toEqual([8, 10]);
  expect(frames.map(value => Number(new DataView(value).getBigInt64(9)))).toEqual([128, 130]);
  expect(frames.map(value => Array.from(new Uint8Array(value).subarray(19)))).toEqual([[8, 2], [10, 2]]);
  expect(store.list()).toEqual(original); expect(enqueue).not.toHaveBeenCalled();
  expect(() => buffer.enqueue(chunk(11))).toThrow('yeni ses');
  io.event({ type: 'audio_ack', chunk_seq: 99 });
  io.event({ type: 'audio_ack', chunk_seq: 8 }); io.event({ type: 'audio_ack', chunk_seq: 8 });
  expect(buffer.pending()).toBe(1);
  expect(io.ws.send).toHaveBeenCalledTimes(2);
  io.event({ type: 'audio_ack', chunk_seq: 10 });
  expect(io.ws.send).toHaveBeenLastCalledWith('{"type":"eof"}');
  io.event({ type: 'drained' });
  expect(await attempt.result).toEqual({ state: 'gateway-drained', historyComplete: false });
  expect(jest.getTimerCount()).toBe(0);
});

test('a lost receipt is replayed on a manual retry and obsolete socket events cannot delete it', async () => {
  const buffer = new OfflineAudioBuffer(); buffer.enqueue(chunk(5));
  const first = socket(); const attempt = replayPendingAudio(first.ws, buffer);
  first.event({ type: 'ready' }); await jest.advanceTimersByTimeAsync(250);
  first.ws.onclose?.({ code: 1006 }); expect((await attempt.result).state).toBe('failed');
  expect(buffer.pending()).toBe(1);
  const second = socket(); const retry = replayPendingAudio(second.ws, buffer);
  second.event({ type: 'ready' }); await jest.advanceTimersByTimeAsync(250);
  expect(jest.mocked(first.ws.send).mock.calls[0][0]).toEqual(jest.mocked(second.ws.send).mock.calls[0][0]);
  first.event({ type: 'audio_ack', chunk_seq: 5 }); first.event({ type: 'drained' });
  expect(buffer.pending()).toBe(1);
  second.event({ type: 'audio_ack', chunk_seq: 5 }); second.event({ type: 'drained' });
  expect((await retry.result).state).toBe('gateway-drained');
});

test.each(['before', 'during'] as const)('TTL loss %s replay never sends EOF or claims completion', async when => {
  const buffer = new OfflineAudioBuffer({ ttlMs: 1000 }); buffer.enqueue(chunk(3));
  if (when === 'before') jest.setSystemTime(Date.now() + 1001);
  const io = socket(); const attempt = replayPendingAudio(io.ws, buffer);
  io.event({ type: 'ready' });
  await jest.advanceTimersByTimeAsync(when === 'before' ? 1 : 1001);
  expect((await attempt.result).state).toBe('failed');
  expect(io.ws.send).not.toHaveBeenCalledWith('{"type":"eof"}');
  if (when === 'before') expect(io.ws.send).not.toHaveBeenCalled();
});

test('capacity loss before replay refuses all transmission', async () => {
  const buffer = new OfflineAudioBuffer({ maxChunks: 1 }); buffer.enqueue(chunk(1)); buffer.enqueue(chunk(2));
  const io = socket(); const attempt = replayPendingAudio(io.ws, buffer); io.event({ type: 'ready' });
  expect((await attempt.result).state).toBe('failed'); expect(io.ws.send).not.toHaveBeenCalled();
});

test('an empty queue still needs terminal drain, and that does not certify historic completeness', async () => {
  const io = socket(); const attempt = replayPendingAudio(io.ws, new OfflineAudioBuffer());
  io.event({ type: 'drained' }); expect(io.ws.send).not.toHaveBeenCalled();
  io.event({ type: 'ready' }); expect(io.ws.send).toHaveBeenCalledWith('{"type":"eof"}');
  io.event({ type: 'drained' }); expect(await attempt.result).toEqual({ state: 'gateway-drained', historyComplete: false });
});

test.each(['readiness', 'receipt', 'drain'] as const)('bounded %s timeout retains undelivered rows', async stage => {
  const buffer = new OfflineAudioBuffer(); buffer.enqueue(chunk(2));
  const io = socket(); const attempt = replayPendingAudio(io.ws, buffer);
  if (stage !== 'readiness') { io.event({ type: 'ready' }); await jest.advanceTimersByTimeAsync(250); }
  if (stage === 'drain') io.event({ type: 'audio_ack', chunk_seq: 2 });
  await jest.advanceTimersByTimeAsync(16000);
  expect((await attempt.result).state).toBe('failed');
  expect(buffer.pending()).toBe(stage === 'drain' ? 0 : 1);
  expect(jest.getTimerCount()).toBe(0);
});

test('cancel closes transport, retains audio and ignores late ready/ACK/drained', async () => {
  const buffer = new OfflineAudioBuffer(); buffer.enqueue(chunk(2));
  const io = socket(); const attempt = replayPendingAudio(io.ws, buffer); attempt.cancel(); attempt.cancel();
  io.event({ type: 'ready' }); io.event({ type: 'audio_ack', chunk_seq: 2 }); io.event({ type: 'drained' });
  expect((await attempt.result).state).toBe('cancelled'); expect(buffer.pending()).toBe(1);
  expect(io.ws.close).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});

test('concurrent replay cannot reset the same queue or close its active socket; retry after cancel is allowed', async () => {
  const buffer = new OfflineAudioBuffer(); buffer.enqueue(chunk(2));
  const first = socket(); const second = socket();
  const attempt = replayPendingAudio(first.ws, buffer);
  expect(() => replayPendingAudio(second.ws, buffer)).toThrow('zaten');
  expect(second.ws.close).toHaveBeenCalledTimes(1); expect(first.ws.close).not.toHaveBeenCalled();
  expect(() => replayPendingAudio(first.ws, buffer)).toThrow('zaten');
  expect(first.ws.close).not.toHaveBeenCalled();
  attempt.cancel(); expect((await attempt.result).state).toBe('cancelled');
  const retry = replayPendingAudio(socket().ws, buffer); retry.cancel();
  expect((await retry.result).state).toBe('cancelled'); expect(buffer.pending()).toBe(1);
});
