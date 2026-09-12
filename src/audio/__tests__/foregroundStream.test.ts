import { ForegroundStream, type LiveSocket } from '../foregroundStream';
import { OfflineAudioBuffer } from '../offlineBuffer';

function setup(buffer?: OfflineAudioBuffer) {
  const socket: LiveSocket = { readyState: 1, bufferedAmount: 0, onopen: null, onmessage: null, onerror: null, onclose: null, send: jest.fn(), close: jest.fn() };
  const ready = jest.fn(); const text = jest.fn(); const fail = jest.fn();
  const client = new ForegroundStream(socket, ready, text, fail, buffer);
  const event = (value: object) => socket.onmessage?.({ data: JSON.stringify(value) });
  return { socket, client, ready, text, fail, event };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('diagnostics distinguish sent frames from receipts and never retain transcript content', async () => {
  const { client, event } = setup(new OfflineAudioBuffer());
  event({ type: 'ready' });
  client.send(new ArrayBuffer(2), 16000, 1, 0);
  expect(client.diagnostics()).toMatchObject({ sentFrames: 1, acknowledgedFrames: 0, pendingFrames: 1 });
  event({ type: 'audio_ack', chunk_seq: 0 });
  event({ type: 'audio_ack', chunk_seq: 0 });
  event({ type: 'final', seq: 0, text: 'private speech must not be logged' });
  expect(client.diagnostics()).toMatchObject({ acknowledgedFrames: 1, pendingFrames: 0, finalEvents: 1 });
  expect(JSON.stringify(client.diagnostics())).not.toContain('private speech');
  const stopped = client.stop();
  event({ type: 'drained' });
  expect(await stopped).toBe(true);
  expect(client.diagnostics().drainedUtc).not.toBe('');
});

function recoverySetup() {
  const makeSocket = (): LiveSocket => ({ readyState: 1, bufferedAmount: 0, onopen: null, onmessage: null,
    onerror: null, onclose: null, send: jest.fn(), close: jest.fn() });
  const first = makeSocket(); const second = makeSocket(); const buffer = new OfflineAudioBuffer();
  const ready = jest.fn(); const fail = jest.fn(); const connect = jest.fn(async () => second);
  const client = new ForegroundStream(first, ready, jest.fn(), fail, buffer, { connect, onStatus: jest.fn() });
  const emit = (socket: LiveSocket, value: object) => socket.onmessage?.({ data: JSON.stringify(value) });
  return { first, second, buffer, ready, fail, connect, client, emit };
}

test('reconnect retains original sequence and ignores receipts from the old socket', async () => {
  const { first, second, buffer, ready, client, emit } = recoverySetup();
  emit(first, { type: 'ready' });
  client.send(new ArrayBuffer(2), 16000, 1, 0);
  first.onclose?.({ code: 1006 });
  expect(client.send(new ArrayBuffer(2), 16000, 1, 1)).toBe(true);
  emit(first, { type: 'audio_ack', chunk_seq: 0 }); expect(buffer.pending()).toBe(2);
  await jest.advanceTimersByTimeAsync(500);
  emit(second, { type: 'ready' });
  const frames = jest.mocked(second.send).mock.calls.map(([frame]) => new DataView(frame as ArrayBuffer).getBigInt64(1));
  expect(frames).toEqual([0n, 1n]); expect(ready).toHaveBeenCalledTimes(1);
  emit(second, { type: 'audio_ack', chunk_seq: 0 }); emit(second, { type: 'audio_ack', chunk_seq: 1 });
  expect(buffer.pending()).toBe(0);
  client.dispose(); expect(jest.getTimerCount()).toBe(0);
});

test('does not retry explicit server policy rejection', async () => {
  const { first, client, emit, connect, fail } = recoverySetup();
  emit(first, { type: 'ready' }); first.onclose?.({ code: 1008 });
  await jest.advanceTimersByTimeAsync(30000);
  expect(connect).not.toHaveBeenCalled(); expect(fail).toHaveBeenCalledTimes(1);
  client.dispose();
});

test('stopping during recovery cancels future connections without discarding unacknowledged audio', async () => {
  const { first, buffer, client, emit, connect } = recoverySetup();
  emit(first, { type: 'ready' }); client.send(new ArrayBuffer(2), 16000, 1, 0);
  first.onclose?.({ code: 1006 }); const stopped = client.stop();
  await jest.advanceTimersByTimeAsync(12000);
  expect(await stopped).toBe(false); expect(connect).not.toHaveBeenCalled(); expect(buffer.pending()).toBe(1);
});

test('a hung socket factory is bounded and late sockets are disposed', async () => {
  const { first, second, client, emit, connect, fail } = recoverySetup();
  let late!: (socket: LiveSocket) => void;
  connect.mockImplementation(() => new Promise(resolve => { late = resolve; }));
  emit(first, { type: 'ready' }); first.onclose?.({ code: 1006 });
  await jest.advanceTimersByTimeAsync(50000);
  expect(connect).toHaveBeenCalledTimes(3); expect(fail).toHaveBeenCalledTimes(1);
  late(second); await Promise.resolve();
  expect(second.close).toHaveBeenCalled(); client.dispose();
});

test('bounded memory queue drains when backpressure clears even after capture stops', async () => {
  const { client, socket, event } = setup(new OfflineAudioBuffer());
  event({ type: 'ready' }); socket.bufferedAmount = 128001;
  expect(client.send(new ArrayBuffer(2), 16000, 1, 0)).toBe(true);
  expect(socket.send).not.toHaveBeenCalled();
  const stopping = client.stop();
  socket.bufferedAmount = 0;
  jest.advanceTimersByTime(250);
  expect(socket.send).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(250);
  expect(socket.send).toHaveBeenCalledTimes(1); // Await receipt; do not duplicate in-flight data.
  event({ type: 'audio_ack', chunk_seq: 0 });
  expect(socket.send).toHaveBeenLastCalledWith('{"type":"eof"}');
  event({ type: 'drained' }); expect(await stopping).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

test('unknown acknowledgements cannot keep a stalled delivery alive', () => {
  const { client, event, fail } = setup(new OfflineAudioBuffer());
  event({ type: 'ready' }); client.send(new ArrayBuffer(2), 16000, 1, 0);
  jest.advanceTimersByTime(9000);
  event({ type: 'audio_ack', chunk_seq: 999 });
  jest.advanceTimersByTime(1000);
  expect(fail).toHaveBeenCalledTimes(1);
  expect(fail.mock.calls[0][0]).toContain('10 saniyedir');
  expect(jest.getTimerCount()).toBe(0);
});

test('real stream holds PCM until gateway ACK and waits before EOF', async () => {
  const buffer = new OfflineAudioBuffer();
  const { client, event, socket } = setup(buffer);
  event({ type: 'ready' }); client.send(new ArrayBuffer(2), 16000, 1, 0);
  expect(buffer.pending()).toBe(1);
  const stopped = client.stop();
  expect(socket.send).not.toHaveBeenCalledWith('{"type":"eof"}');
  event({ type: 'audio_ack', chunk_seq: 99 });
  expect(buffer.pending()).toBe(1);
  event({ type: 'audio_ack', chunk_seq: 0 });
  expect(buffer.pending()).toBe(0);
  expect(socket.send).toHaveBeenCalledWith('{"type":"eof"}');
  event({ type: 'drained' }); expect(await stopped).toBe(true);
});

test('missing ACK cannot be turned into success by an early drained event', async () => {
  const { client, event, fail } = setup(new OfflineAudioBuffer());
  event({ type: 'ready' }); client.send(new ArrayBuffer(2), 16000, 1, 0);
  const stopped = client.stop(); event({ type: 'drained' });
  jest.advanceTimersByTime(12000);
  expect(await stopped).toBe(false);
  expect(fail.mock.calls[0][0]).toContain('bekleyen ses parçası: 1');
});

test('error followed by close preserves the close code without exposing raw reason', () => {
  const { socket, fail } = setup();
  socket.onerror?.();
  expect(fail).not.toHaveBeenCalled();
  socket.onclose?.({ code: 1008, reason: 'Bearer secret user@example.test' });
  expect(fail).toHaveBeenCalledTimes(1);
  expect(fail.mock.calls[0][0]).toContain('1008');
  expect(fail.mock.calls[0][0]).toContain('Ses bağlantısının açılması');
  expect(fail.mock.calls[0][0]).not.toContain('secret');
  jest.advanceTimersByTime(500);
  expect(fail).toHaveBeenCalledTimes(1);
});

test('close before ready is distinguished from a recording failure', () => {
  const { socket, fail } = setup();
  socket.onopen?.();
  socket.onclose?.({ code: 1011 });
  expect(fail.mock.calls[0][0]).toContain('Ses sunucusunun hazır olması');
  expect(fail.mock.calls[0][0]).toContain('1011');
});

test('error without close eventually reports an unknown cause and sends no further audio', () => {
  const { socket, event, client, fail } = setup();
  event({ type: 'ready' }); socket.onerror?.();
  expect(client.send(new ArrayBuffer(2), 16000, 1, 0)).toBe(false);
  jest.advanceTimersByTime(500);
  expect(fail.mock.calls[0][0]).toContain('iletilmedi');
  expect(fail.mock.calls[0][0]).toContain('henüz doğrulanmadı');
});

test('sunucu ready olmadan mikrofon verisi göndermez', () => {
  const { socket, client, event, ready } = setup();
  expect(client.send(new ArrayBuffer(2), 16000, 1, 0)).toBe(false);
  expect(socket.send).not.toHaveBeenCalled();
  event({ type: 'ready' }); expect(ready).toHaveBeenCalledTimes(1);
  expect(client.send(new ArrayBuffer(2), 16000, 1, 0)).toBe(true);
  client.dispose();
});
test('farklı örnekleme hızını 16kHz olarak yanlış etiketlemez', () => {
  const { socket, client, event, fail } = setup();
  event({ type: 'ready' });
  expect(client.send(new ArrayBuffer(2), 48000, 1, 0)).toBe(false);
  expect(socket.send).not.toHaveBeenCalled(); expect(fail).toHaveBeenCalledTimes(1);
});
test('bağlantı yavaşladığında yakalamayı durdurmak için hata bildirir', () => {
  const { socket, client, event, fail } = setup();
  event({ type: 'ready' }); socket.bufferedAmount = 128001;
  expect(client.send(new ArrayBuffer(2), 16000, 1, 0)).toBe(false);
  expect(socket.close).toHaveBeenCalled(); expect(fail).toHaveBeenCalledTimes(1);
});
test('EOF sonrası gelen final metni alır, yalnız drained ile başarı döner', async () => {
  const { socket, client, event, text } = setup(); event({ type: 'ready' });
  const result = client.stop();
  expect(socket.send).toHaveBeenCalledWith('{"type":"eof"}');
  event({ type: 'final', seq: 0, text: 'Merhaba' });
  expect(text).toHaveBeenCalledWith({ seq: 0, text: 'Merhaba', final: true });
  event({ type: 'drained' }); expect(await result).toBe(true);
});
test('drain zaman aşımını başarılı test olarak sunmaz', async () => {
  const { client, event, fail } = setup(); event({ type: 'ready' });
  const result = client.stop(); jest.advanceTimersByTime(12000);
  expect(await result).toBe(false); expect(fail).toHaveBeenCalledTimes(1);
});
test('kapandıktan sonra gelen olayları yok sayar', () => {
  const { client, event, text, ready } = setup(); client.dispose();
  event({ type: 'ready' }); event({ type: 'final', seq: 0, text: 'geç' });
  expect(ready).not.toHaveBeenCalled(); expect(text).not.toHaveBeenCalled();
});
