import { ForegroundStream, type LiveSocket } from '../foregroundStream';
import { OfflineAudioBuffer } from '../offlineBuffer';
import { applyTranscriptEvent, initialTranscriptState } from '../../transcript/transcriptState';

function setup(buffer?: OfflineAudioBuffer) {
  const socket: LiveSocket = { readyState: 1, bufferedAmount: 0, onopen: null, onmessage: null, onerror: null, onclose: null, send: jest.fn(), close: jest.fn() };
  const ready = jest.fn(); const text = jest.fn(); const fail = jest.fn();
  const client = new ForegroundStream(socket, ready, text, fail, buffer);
  const event = (value: object) => socket.onmessage?.({ data: JSON.stringify(value) });
  return { socket, client, ready, text, fail, event };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test.each(['SPEECHMATICS_BUFFER_ERROR', 'SPEECHMATICS_QUOTA_EXCEEDED', 'PRIVATE transcript/token', null])(
  'terminal provider errors retain pending PCM and expose only an allowlisted code: %s', (msg) => {
    const { client, event, fail, socket } = setup(new OfflineAudioBuffer());
    event({ type: 'ready' });
    client.send(new ArrayBuffer(3200), 16000, 1, 0);
    event({ type: 'error', msg, reason: 'PRIVATE' });
    const expected = typeof msg === 'string' && msg.startsWith('SPEECHMATICS_') ? msg : 'SERVER_ERROR_UNCLASSIFIED';
    expect(client.diagnostics()).toMatchObject({ pendingFrames: 1, serverErrorCode: expected });
    expect(client.completionConfirmed()).toBe(false);
    expect(fail).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledWith(expect.stringContaining(expected));
    expect(JSON.stringify([client.diagnostics(), fail.mock.calls])).not.toContain('PRIVATE');
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  },
);

test('preserves validated source sample ranges without altering received text or inventing invalid ranges', () => {
  const { client, event, text } = setup();
  event({ type: 'ready' });
  event({ type: 'final', seq: 1, text: 'Zeynep.', source_start_sample: 1600, source_end_sample: 8000 });
  expect(text).toHaveBeenLastCalledWith({ connectionId: 1, seq: 1, text: 'Zeynep.', final: true, sourceStartSample: 1600, sourceEndSample: 8000 });
  event({ type: 'final', seq: 2, text: 'Sunumu hazırlayacak.', source_start_sample: -1, source_end_sample: 5 });
  expect(text).toHaveBeenLastCalledWith({ connectionId: 1, seq: 2, text: 'Sunumu hazırlayacak.', final: true });
  client.dispose();
});

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
  const ready = jest.fn(); const fail = jest.fn(); const text = jest.fn(); const connect = jest.fn(async () => second);
  const client = new ForegroundStream(first, ready, text, fail, buffer, { connect, onStatus: jest.fn() });
  const emit = (socket: LiveSocket, value: object) => socket.onmessage?.({ data: JSON.stringify(value) });
  return { first, second, buffer, ready, fail, text, connect, client, emit };
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

test('a 30 second outage with fast connection failures preserves audio until the network returns', async () => {
  const { first, second, buffer, ready, fail, connect, client, emit } = recoverySetup();
  let online = false;
  connect.mockImplementation(async () => {
    if (!online) throw new Error('Network unavailable');
    return second;
  });
  emit(first, { type: 'ready' });
  client.send(new ArrayBuffer(32000), 16000, 1, Date.now());
  emit(first, { type: 'audio_ack', chunk_seq: 0 });
  first.onclose?.({ code: 1006 });
  for (let second = 0; second < 30; second++) {
    expect(client.send(new ArrayBuffer(32000), 16000, 1, Date.now())).toBe(true);
    await jest.advanceTimersByTimeAsync(1000);
  }
  expect(fail).not.toHaveBeenCalled();
  expect(buffer.pending()).toBe(30);
  online = true;
  await jest.advanceTimersByTimeAsync(10000);
  emit(second, { type: 'ready' });
  expect(ready).toHaveBeenCalledTimes(1); // Reconnect must not restart the microphone.
  const replayed = jest.mocked(second.send).mock.calls.map(([frame]) => new DataView(frame as ArrayBuffer).getBigInt64(1));
  expect(replayed).toEqual(Array.from({ length: 30 }, (_, i) => BigInt(i + 1)));
  for (let seq = 1; seq <= 30; seq++) emit(second, { type: 'audio_ack', chunk_seq: seq });
  expect(buffer.pending()).toBe(0);
  expect(client.send(new ArrayBuffer(32000), 16000, 1, Date.now())).toBe(true);
  emit(second, { type: 'audio_ack', chunk_seq: 31 });
  const stopped = client.stop();
  emit(second, { type: 'drained' });
  expect(await stopped).toBe(true);
  expect(client.completionConfirmed()).toBe(false); // Delivery is not provider continuity proof.
  expect(fail).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('reconnect keeps text chronological without overwriting old finals or leaving an active draft', async () => {
  const makeSocket = (): LiveSocket => ({ readyState: 1, bufferedAmount: 0, onopen: null, onmessage: null,
    onerror: null, onclose: null, send: jest.fn(), close: jest.fn() });
  const [first, second, third] = [makeSocket(), makeSocket(), makeSocket()];
  const connect = jest.fn().mockResolvedValueOnce(second).mockResolvedValueOnce(third);
  let state = initialTranscriptState();
  const ready = jest.fn(), fail = jest.fn();
  const client = new ForegroundStream(first, ready, line => {
    state = applyTranscriptEvent(state, line.final
      ? { type: 'final', ...line }
      : { type: 'partial', ...line, confirmed: line.confirmed ?? '', tentative: line.tentative ?? '' });
  }, fail, new OfflineAudioBuffer(), { connect, onStatus: jest.fn(), onConnectionInterrupted: connectionId => {
    state = applyTranscriptEvent(state, { type: 'connection_interrupted', connectionId });
  } });
  const emit = (socket: LiveSocket, event: object) => socket.onmessage?.({ data: JSON.stringify(event) });
  emit(first, { type: 'ready' });
  emit(first, { type: 'final', seq: 0, text: 'İlk görev.' });
  emit(first, { type: 'final', seq: 1, text: 'İkinci görev.' });
  emit(first, { type: 'partial', seq: 2, confirmed: 'Yarım', tentative: 'cümle' });
  first.onclose?.({ code: 1006 });
  expect(state.lines.map(line => line.status)).toEqual(['final', 'final', 'interrupted']);
  const interrupted = state;
  await jest.advanceTimersByTimeAsync(500);
  emit(second, { type: 'ready' });
  expect(state).toBe(interrupted); // Successful reconnect with silence does not resurrect a draft.
  emit(first, { type: 'final', seq: 0, text: 'STALE_FINAL' });
  emit(first, { type: 'partial', seq: 99, confirmed: '', tentative: 'STALE_PARTIAL' });
  expect(state).toBe(interrupted);
  emit(second, { type: 'partial', seq: 0, confirmed: '', tentative: 'Yeni taslak' });
  expect(state.lines.at(-1)).toMatchObject({ seq: 0, text: 'Yeni taslak', status: 'draft' });
  second.onclose?.({ code: 1006 }); // No final at all on the second bridge.
  expect(state.lines.at(-1)?.status).toBe('interrupted');
  await jest.advanceTimersByTimeAsync(1000);
  emit(third, { type: 'ready' });
  const next = { type: 'final', seq: 0, text: 'Saat on bir olacak.' };
  emit(third, next);
  const beforeReplay = state;
  emit(third, next); expect(state).toBe(beforeReplay);
  emit(second, { type: 'final', seq: 0, text: 'STALE_SECOND' });
  expect(state).toBe(beforeReplay);
  emit(third, { ...next, text: 'Saat on iki olacak.' });
  expect(state.lines.map(line => [line.connectionId, line.seq, line.text, line.status])).toEqual([
    [1, 0, 'İlk görev.', 'final'], [1, 1, 'İkinci görev.', 'final'], [1, 2, 'Yarım cümle', 'interrupted'],
    [3, 0, 'Yeni taslak', 'interrupted'], [5, 0, 'Saat on iki olacak.', 'revised'],
  ]);
  expect(ready).toHaveBeenCalledTimes(1);
  expect(fail).not.toHaveBeenCalled();
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
  await jest.advanceTimersByTimeAsync(59999);
  expect(fail).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(fail).toHaveBeenCalledTimes(1);
  expect(fail.mock.calls[0][0]).toContain('60 saniye');
  late(second); await Promise.resolve();
  expect(second.close).toHaveBeenCalled();
  const attempts = connect.mock.calls.length;
  await jest.advanceTimersByTimeAsync(30000);
  expect(connect).toHaveBeenCalledTimes(attempts);
  client.dispose(); expect(jest.getTimerCount()).toBe(0);
});

test('fast failures get the same finite window and leave unacknowledged audio intact', async () => {
  const { first, buffer, client, emit, connect, fail } = recoverySetup();
  connect.mockRejectedValue(new Error('Offline'));
  emit(first, { type: 'ready' });
  client.send(new ArrayBuffer(2), 16000, 1, Date.now());
  first.onclose?.({ code: 1006 });
  await jest.advanceTimersByTimeAsync(59999);
  expect(fail).not.toHaveBeenCalled();
  expect(connect.mock.calls.length).toBeGreaterThan(3);
  await jest.advanceTimersByTimeAsync(1);
  expect(fail).toHaveBeenCalledTimes(1);
  expect(fail.mock.calls[0][0]).toContain('bekleyen ses parçası: 1');
  expect(buffer.pending()).toBe(1);
  expect(client.completionConfirmed()).toBe(false);
  expect(jest.getTimerCount()).toBe(0);
});

test('ready then close without a receipt cannot repeatedly extend the recovery window', async () => {
  const { first, second, buffer, client, emit, connect, fail } = recoverySetup();
  let nextSocket: LiveSocket | undefined;
  connect.mockImplementation(async () => {
    nextSocket = { ...second, onopen: null, onmessage: null, onclose: null, onerror: null };
    return nextSocket;
  });
  emit(first, { type: 'ready' });
  client.send(new ArrayBuffer(2), 16000, 1, Date.now());
  first.onclose?.({ code: 1006 });
  for (let elapsed = 0; elapsed < 59000; elapsed += 500) {
    await jest.advanceTimersByTimeAsync(500);
    if (nextSocket) {
      emit(nextSocket, { type: 'ready' });
      nextSocket.onclose?.({ code: 1006 });
      nextSocket = undefined;
    }
  }
  expect(fail).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1000);
  expect(fail).toHaveBeenCalledTimes(1);
  expect(buffer.pending()).toBe(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('receipted recovery clears the outage deadline and permits a later independent outage', async () => {
  const { first, second, client, buffer, emit, fail } = recoverySetup();
  emit(first, { type: 'ready' });
  client.send(new ArrayBuffer(2), 16000, 1, Date.now());
  first.onclose?.({ code: 1006 });
  await jest.advanceTimersByTimeAsync(500);
  emit(second, { type: 'ready' });
  emit(second, { type: 'audio_ack', chunk_seq: 0 });
  await jest.advanceTimersByTimeAsync(60000);
  expect(fail).not.toHaveBeenCalled();
  second.onclose?.({ code: 1006 });
  expect(client.send(new ArrayBuffer(2), 16000, 1, Date.now())).toBe(true);
  await jest.advanceTimersByTimeAsync(500);
  emit(second, { type: 'ready' });
  emit(second, { type: 'audio_ack', chunk_seq: 1 });
  expect(buffer.pending()).toBe(0);
  expect(fail).not.toHaveBeenCalled();
  client.dispose(); expect(jest.getTimerCount()).toBe(0);
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
  expect(text).toHaveBeenCalledWith({ connectionId: 1, seq: 0, text: 'Merhaba', final: true });
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

test('a new bridge drained after reconnect cannot prove full recording completion', async () => {
  const { first, second, client, emit } = recoverySetup();
  emit(first, { type: 'ready' }); client.send(new ArrayBuffer(2), 16000, 1, 0);
  emit(first, { type: 'audio_ack', chunk_seq: 0 });
  first.onclose?.({ code: 1006 }); await jest.advanceTimersByTimeAsync(500);
  emit(second, { type: 'ready' });
  const stopping = client.stop(); emit(second, { type: 'drained' });
  expect(await stopping).toBe(true); expect(client.completionConfirmed()).toBe(false);
  expect(client.diagnostics().continuityLost).toBe(true);
});
test('an uninterrupted bridge can confirm completion only after drained', async () => {
  const { client, event } = setup(new OfflineAudioBuffer()); event({ type: 'ready' });
  expect(client.completionConfirmed()).toBe(false);
  const stopping = client.stop(); event({ type: 'drained' });
  expect(await stopping).toBe(true); expect(client.completionConfirmed()).toBe(true);
});

const resumeEpoch = '11111111-2222-4333-8444-555555555555';
const resumeReady = (after: number, through: number, epoch = resumeEpoch) => ({ type: 'ready',
  resume_protocol: 'recording-resume-v1', source_epoch: epoch, replay_after: after, replay_through: through });
const resumed = (through: number) => ({ type: 'resume_complete', source_epoch: resumeEpoch, replay_through: through });

test('same provider survives 30s offline capture, replays missed finals once and proves completion', async () => {
  const { first, second, client, emit, text, connect, ready, fail, buffer } = recoverySetup();
  emit(first, resumeReady(-1, -1));
  expect(ready).not.toHaveBeenCalled();
  emit(first, resumed(-1));
  expect(ready).toHaveBeenCalledTimes(1);
  client.send(new ArrayBuffer(3200), 16000, 1, 0);
  emit(first, { type: 'audio_ack', chunk_seq: 0 });
  emit(first, { type: 'final', seq: 0, text: 'Online first.' });
  first.onclose?.({ code: 1006 });
  connect.mockRejectedValueOnce(new Error('Offline'));
  for (let count = 0; count < 30; count++) {
    expect(client.send(new ArrayBuffer(3200), 16000, 1, count + 1)).toBe(true);
    await jest.advanceTimersByTimeAsync(1000);
  }
  expect(connect).toHaveBeenLastCalledWith({ sourceEpoch: resumeEpoch, afterFinal: 0 });
  emit(second, resumeReady(0, 1));
  expect(second.send).not.toHaveBeenCalled();
  expect(client.diagnostics().continuityLost).toBe(true);
  emit(second, { type: 'final', seq: 1, text: 'Final emitted while detached.' });
  emit(second, resumed(1));
  expect(client.diagnostics().continuityLost).toBe(false);
  expect(ready).toHaveBeenCalledTimes(1);
  expect(second.send).toHaveBeenCalledTimes(30);
  for (let seq = 1; seq <= 30; seq++) emit(second, { type: 'audio_ack', chunk_seq: seq });
  emit(second, { type: 'final', seq: 1, text: 'Final emitted while detached.' });
  emit(second, { type: 'final', seq: 2, text: 'Offline speech recovered.' });
  expect(text.mock.calls.map(([line]) => [line.connectionId, line.seq])).toEqual([[1, 0], [1, 1], [1, 2]]);
  expect(buffer.pending()).toBe(0);
  const stop = client.stop(); emit(second, { type: 'drained' });
  expect(await stop).toBe(true);
  expect(client.completionConfirmed()).toBe(true);
  expect(fail).not.toHaveBeenCalled();
});

test.each(['foreign epoch', 'missing final', 'wrong cursor', 'legacy ready'])('resume proof fails closed: %s', async variant => {
  const { first, second, client, emit, fail } = recoverySetup();
  emit(first, resumeReady(-1, -1)); emit(first, resumed(-1));
  first.onclose?.({ code: 1006 }); await jest.advanceTimersByTimeAsync(500);
  if (variant === 'foreign epoch') emit(second, resumeReady(-1, -1, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'));
  else if (variant === 'wrong cursor') emit(second, resumeReady(0, 0));
  else if (variant === 'legacy ready') emit(second, { type: 'ready' });
  else { emit(second, resumeReady(-1, 0)); emit(second, resumed(0)); }
  expect(fail).toHaveBeenCalledTimes(1);
  expect(client.completionConfirmed()).toBe(false);
  expect(client.diagnostics().continuityLost).toBe(true);
  expect(second.send).not.toHaveBeenCalled();
});

test.each(['partial', 'final'])('replacement socket rejects %s before its resume handshake', async type => {
  const { first, second, client, emit, fail, text } = recoverySetup();
  emit(first, resumeReady(-1, -1)); emit(first, resumed(-1));
  first.onclose?.({ code: 1006 }); await jest.advanceTimersByTimeAsync(500);
  emit(second, { type, seq: 0, text: 'Unverified', confirmed: '', tentative: 'Unverified' });
  expect(text).not.toHaveBeenCalled();
  expect(fail).toHaveBeenCalledTimes(1);
  expect(client.completionConfirmed()).toBe(false);
});

test.each([false, true])('negotiated provider final remains accepted during EOF drain, reconnect=%s', async reconnect => {
  const { first, second, client, emit, fail, text } = recoverySetup();
  emit(first, resumeReady(-1, -1)); emit(first, resumed(-1));
  let current = first;
  if (reconnect) {
    first.onclose?.({ code: 1006 }); await jest.advanceTimersByTimeAsync(500);
    emit(second, resumeReady(-1, -1)); emit(second, resumed(-1)); current = second;
  }
  client.send(new ArrayBuffer(3200), 16000, 1, 0);
  emit(current, { type: 'audio_ack', chunk_seq: 0 });
  const stopping = client.stop();
  emit(current, { type: 'final', seq: 0, text: 'Final after stop.' });
  emit(current, { type: 'drained' });
  expect(text).toHaveBeenCalledWith(expect.objectContaining({ text: 'Final after stop.', final: true, sourceContinued: true }));
  expect(await stopping).toBe(true);
  expect(client.completionConfirmed()).toBe(true);
  expect(fail).not.toHaveBeenCalled();
});

test('a resume final gap never advances the consumer cursor', () => {
  const { client, event, text, fail } = setup();
  event(resumeReady(-1, -1)); event(resumed(-1));
  event({ type: 'final', seq: 1, text: 'Missing sequence zero.' });
  expect(text).not.toHaveBeenCalled(); expect(fail).toHaveBeenCalledTimes(1);
  expect(client.completionConfirmed()).toBe(false);
});
test('verified replay replaces interrupted draft in the actual transcript reducer before continuity proof', async () => {
  const socket = (): LiveSocket => ({ readyState: 1, bufferedAmount: 0, onopen: null, onmessage: null,
    onerror: null, onclose: null, send: jest.fn(), close: jest.fn() });
  const first = socket(); const second = socket(); const fail = jest.fn();
  let state = initialTranscriptState();
  const stream = new ForegroundStream(first, jest.fn(), line => {
    state = applyTranscriptEvent(state, line.final
      ? { type: 'final', connectionId: line.connectionId, sourceContinued: line.sourceContinued, seq: line.seq, text: line.text }
      : { type: 'partial', connectionId: line.connectionId, seq: line.seq, confirmed: line.confirmed ?? '', tentative: line.tentative ?? '' });
  }, fail, new OfflineAudioBuffer(), {
    connect: async () => second, onStatus: jest.fn(),
    onConnectionInterrupted: connectionId => { state = applyTranscriptEvent(state, { type: 'connection_interrupted', connectionId }); },
  });
  const emit = (target: LiveSocket, value: object) => target.onmessage?.({ data: JSON.stringify(value) });
  emit(first, resumeReady(-1, -1)); emit(first, resumed(-1));
  emit(first, { type: 'partial', seq: 0, confirmed: '', tentative: 'unfinished' });
  first.onclose?.({ code: 1006 });
  expect(state.lines[0].status).toBe('interrupted');
  await jest.advanceTimersByTimeAsync(500);
  emit(second, resumeReady(-1, 0));
  emit(second, { type: 'final', seq: 0, text: 'Recovered complete sentence.' });
  expect(state.lines).toHaveLength(1);
  expect(state.lines[0]).toMatchObject({ connectionId: 1, seq: 0, text: 'Recovered complete sentence.', status: 'final' });
  emit(first, { type: 'final', seq: 0, text: 'stale callback' });
  expect(state.lines[0].text).toBe('Recovered complete sentence.');
  emit(second, resumed(0));
  expect(stream.diagnostics().continuityLost).toBe(false);
  expect(fail).not.toHaveBeenCalled();
  stream.dispose();
});
