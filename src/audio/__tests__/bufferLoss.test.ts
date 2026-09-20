import { ForegroundStream, type LiveSocket } from '../foregroundStream';
import { OfflineAudioBuffer, InMemoryChunkStore } from '../offlineBuffer';

function fixture() {
  let now = 0;
  const store = new InMemoryChunkStore();
  const buffer = new OfflineAudioBuffer({ store, ttlMs: 100, now: () => now });
  const socket: LiveSocket = { readyState: 1, bufferedAmount: 0, onopen: null, onclose: null,
    onerror: null, onmessage: null, send: jest.fn(), close: jest.fn() };
  const failed = jest.fn();
  const connect = jest.fn(async () => socket);
  const client = new ForegroundStream(socket, jest.fn(), jest.fn(), failed, buffer, { connect, onStatus: jest.fn() });
  const event = (value: object) => socket.onmessage?.({ data: JSON.stringify(value) });
  event({ type: 'ready' });
  const send = () => client.send(new ArrayBuffer(2), 16000, 1, now);
  const expire = () => { now = 100; buffer.purgeExpired(); };
  const unavailable = () => jest.spyOn(store, 'size').mockImplementation(() => { throw new Error('private db path'); });
  return { client, buffer, store, socket, failed, connect, event, send, expire, unavailable, setNow: (value: number) => { now = value; } };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('timer-purged unacknowledged audio cannot become a successful empty stop', async () => {
  const f = fixture(); f.send(); f.expire();
  const stopped = f.client.stop(); f.event({ type: 'drained' });
  expect(await stopped).toBe(false);
  expect(f.socket.send).not.toHaveBeenCalledWith('{"type":"eof"}');
  expect(f.failed).toHaveBeenCalledTimes(1);
  expect(f.failed.mock.calls[0][0]).toContain('saklama süresi');
  expect(jest.getTimerCount()).toBe(0);
});

test('external purge remains visible before a new capture, even after the queue is empty', () => {
  const f = fixture(); f.send(); f.expire();
  expect(f.send()).toBe(false);
  expect(f.socket.send).toHaveBeenCalledTimes(1);
  expect(f.failed).toHaveBeenCalledTimes(1);
});

test('late ACK cannot erase expiry evidence while waiting for stop', async () => {
  const f = fixture(); f.send();
  const stopped = f.client.stop(); f.expire();
  f.event({ type: 'audio_ack', chunk_seq: 0 }); f.event({ type: 'drained' });
  expect(await stopped).toBe(false);
  expect(f.socket.send).not.toHaveBeenCalledWith('{"type":"eof"}');
  expect(f.client.diagnostics().acknowledgedFrames).toBe(0);
});

test('ACK received at the retention boundary cannot bypass purge', async () => {
  const f = fixture(); f.send(); f.setNow(100);
  f.event({ type: 'audio_ack', chunk_seq: 0 });
  const stopped = f.client.stop(); f.event({ type: 'drained' });
  expect(await stopped).toBe(false);
  expect(f.socket.send).not.toHaveBeenCalledWith('{"type":"eof"}');
});

test('purge during reconnect cancels retry even without a new microphone event', async () => {
  const f = fixture(); f.send(); f.socket.onclose?.({ code: 1006 }); f.expire();
  await jest.advanceTimersByTimeAsync(250);
  expect(f.failed).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1000);
  expect(f.connect).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test.each(['stop', 'receipt', 'flush', 'disconnect'] as const)('closed storage at %s still closes transport and reports one safe failure', async trigger => {
  const f = fixture(); f.send(); f.unavailable();
  if (trigger === 'stop') await expect(f.client.stop()).resolves.toBe(false);
  if (trigger === 'receipt') expect(() => f.event({ type: 'audio_ack', chunk_seq: 0 })).not.toThrow();
  if (trigger === 'flush') expect(() => jest.advanceTimersByTime(250)).not.toThrow();
  if (trigger === 'disconnect') expect(() => f.socket.onclose?.({ code: 1008 })).not.toThrow();
  expect(f.socket.close).toHaveBeenCalledTimes(1);
  expect(f.failed).toHaveBeenCalledTimes(1);
  expect(f.failed.mock.calls[0][0]).not.toContain('private db path');
  expect(() => f.client.diagnostics()).not.toThrow();
  expect(f.client.diagnostics().pendingFrames).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});

test('socket close failure cannot skip failure notification or settle stop as success', async () => {
  const f = fixture(); f.send();
  jest.mocked(f.socket.close).mockImplementation(() => { throw new Error('private transport'); });
  const stopped = f.client.stop();
  expect(() => f.event({ type: 'error' })).not.toThrow();
  expect(await stopped).toBe(false);
  expect(f.failed).toHaveBeenCalledTimes(1);
});

test('acknowledged audio may pass its former retention deadline and still drain successfully', async () => {
  const f = fixture(); f.send(); f.event({ type: 'audio_ack', chunk_seq: 0 }); f.expire();
  const stopped = f.client.stop(); f.event({ type: 'drained' });
  expect(await stopped).toBe(true);
  expect(f.failed).not.toHaveBeenCalled();
});

test('loss inside drain is detected before the remaining audio crosses a sequence gap', () => {
  const f = fixture(); f.socket.bufferedAmount = 128001; f.send();
  f.setNow(50); f.send();
  const originalDrain = f.buffer.drain.bind(f.buffer);
  jest.spyOn(f.buffer, 'drain').mockImplementation(sender => {
    f.setNow(100); // First chunk expires between the outer check and drain's purge.
    return originalDrain(sender);
  });
  f.socket.bufferedAmount = 0;
  jest.advanceTimersByTime(250);
  expect(f.failed).toHaveBeenCalledTimes(1);
  expect(f.socket.send).not.toHaveBeenCalled();
  expect(f.buffer.pending()).toBe(1);
});

test('partial purge records the deleted row even when the next deletion fails', () => {
  const f = fixture(); f.send(); f.send();
  const remove = f.store.remove.bind(f.store);
  jest.spyOn(f.store, 'remove').mockImplementation(seq => {
    if (seq === 1) throw new Error('private storage error');
    remove(seq);
  });
  expect(f.expire).toThrow();
  expect(f.buffer.purged()).toBe(1);
  expect(f.buffer.pending()).toBe(1);
  expect(() => jest.advanceTimersByTime(250)).not.toThrow();
  expect(f.failed).toHaveBeenCalledTimes(1);
});

test('a failing failure callback cannot leave retry or flush timers alive', async () => {
  const f = fixture(); f.send();
  f.failed.mockImplementation(() => { throw new Error('view already gone'); });
  const stopped = f.client.stop();
  expect(() => f.event({ type: 'error' })).not.toThrow();
  expect(await stopped).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
  expect(f.socket.close).toHaveBeenCalledTimes(1);
});

test('a synchronous reconnect factory failure stops rather than escaping a timer', () => {
  const f = fixture(); f.send(); f.socket.onclose?.({ code: 1006 });
  f.connect.mockImplementation(() => { throw new Error('private token error'); });
  expect(() => jest.advanceTimersByTime(500)).not.toThrow();
  expect(f.failed).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
