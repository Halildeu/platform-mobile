import { OfflineAudioBuffer } from '../offlineBuffer';
import { LiveCaptureSession } from '../liveCaptureSession';

test('successful send followed by disconnect retains and replays unacknowledged audio', () => {
  const send = jest.fn(() => true);
  const session = new LiveCaptureSession({ sessionId: 'session-a', send });
  session.pushPcm16(0, 0, new Uint8Array([1, 0]));
  session.flush();
  expect(send).toHaveBeenCalledTimes(1);
  expect(session.pending()).toBe(1);
  session.onReconnected();
  expect(send).toHaveBeenCalledTimes(2);
  session.acknowledge({ sessionId: 'session-b', chunkSeq: 0 });
  expect(session.pending()).toBe(1);
  session.acknowledge({ sessionId: 'session-a', chunkSeq: 0 });
  expect(session.pending()).toBe(0);
});
test('send exceptions retain audio for retry', () => {
  const buffer = new OfflineAudioBuffer();
  buffer.enqueue({ chunkSeq: 0, capturedAtMs: 0, pcm16: new Uint8Array([1, 0]) });
  expect(buffer.drain(() => { throw new Error('closed'); })).toEqual({ sent: 0, remaining: 1 });
  expect(buffer.drain(() => true).sent).toBe(1);
});
test('re-enqueue cannot mutate an in-flight chunk or extend its TTL', () => {
  let now = 0;
  const buffer = new OfflineAudioBuffer({ ttlMs: 100, now: () => now });
  const chunk = { chunkSeq: 0, capturedAtMs: 0, pcm16: new Uint8Array([1, 0]) };
  buffer.enqueue(chunk); buffer.drain(() => true);
  expect(() => buffer.enqueue({ ...chunk, pcm16: new Uint8Array([2, 0]) })).toThrow();
  now = 80; buffer.enqueue(chunk);
  now = 101;
  expect(buffer.drain(() => true)).toEqual({ sent: 0, remaining: 0 });
  expect(buffer.purged()).toBe(1);
});
test('caller mutation does not change queued audio', () => {
  const buffer = new OfflineAudioBuffer();
  const bytes = new Uint8Array([1, 0]);
  buffer.enqueue({ chunkSeq: 0, capturedAtMs: 0, pcm16: bytes }); bytes[0] = 2;
  buffer.drain((chunk) => { expect(chunk.pcm16[0]).toBe(1); return true; });
});
