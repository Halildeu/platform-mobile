import { ChunkDelivery } from '../chunkDelivery';
import { OfflineAudioBuffer } from '../offlineBuffer';
const chunk = (chunkSeq: number) => ({ chunkSeq, capturedAtMs: 0, pcm16: new Uint8Array([1, 2]) });
function setup(buffer = new OfflineAudioBuffer()) {
  const options = { sessionId: 'session-1', buffer, send: jest.fn(() => true), reconnect: jest.fn(), onExhausted: jest.fn(), onGap: jest.fn(), maxRetries: 2 };
  return { ...options, delivery: new ChunkDelivery(options) };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it('retains sent chunks and ignores forged or stale receipts before replaying', () => {
  const { delivery, buffer, send, reconnect } = setup();
  const first = delivery.connection(); delivery.serverReady(first); delivery.push(chunk(0));
  expect(buffer.pending()).toBe(1);
  delivery.receipt(first, '{"type":"audio_ack","chunk_seq":99}');
  delivery.disconnected(first);
  delivery.receipt(first, '{"type":"audio_ack","chunk_seq":0}');
  expect(buffer.pending()).toBe(1);
  jest.advanceTimersByTime(500); expect(reconnect).toHaveBeenCalledTimes(1);
  const second = delivery.connection(); delivery.serverReady(second);
  expect(send.mock.calls).toHaveLength(2);
  delivery.receipt(second, '{"type":"audio_ack","chunk_seq":0}');
  expect(buffer.pending()).toBe(0); delivery.stop();
});
it('bounds retries and cancels a pending reconnect on stop', () => {
  const { delivery, reconnect, onExhausted } = setup();
  delivery.disconnected(delivery.connection()); jest.advanceTimersByTime(500);
  delivery.disconnected(delivery.connection()); jest.advanceTimersByTime(999);
  expect(reconnect).toHaveBeenCalledTimes(1); jest.advanceTimersByTime(1);
  delivery.disconnected(delivery.connection()); expect(onExhausted).toHaveBeenCalledTimes(1);
  expect(reconnect).toHaveBeenCalledTimes(2);
  const next = setup(); next.delivery.disconnected(next.delivery.connection()); next.delivery.stop();
  jest.runAllTimers(); expect(next.reconnect).not.toHaveBeenCalled();
});
it('reports capacity loss and does not silently send a sequence gap', () => {
  const { delivery, send, onGap } = setup(new OfflineAudioBuffer({ maxBytes: 2 }));
  delivery.connection(); delivery.push(chunk(0)); delivery.push(chunk(1));
  expect(onGap).toHaveBeenCalledTimes(1); expect(send).not.toHaveBeenCalled();
});
it('expires audio exactly at the TTL boundary before reconnect replay', () => {
  let now = 0;
  const buffer = new OfflineAudioBuffer({ ttlMs: 100, now: () => now });
  const { delivery, send, onGap } = setup(buffer);
  const connection = delivery.connection(); delivery.push(chunk(0)); now = 100;
  delivery.serverReady(connection);
  expect(buffer.pending()).toBe(0); expect(onGap).toHaveBeenCalledTimes(1); expect(send).not.toHaveBeenCalled();
});
