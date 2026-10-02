import { createRecordingBuffer } from '../recordingBuffer';
import { OfflineAudioBuffer } from '../offlineBuffer';

function fixture(retentionMs: unknown = 60000) {
  const buffer = new OfflineAudioBuffer();
  const handle = { buffer, close: jest.fn(), destroy: jest.fn(async () => {}),
    confirmDrained: jest.fn(async () => {}), markLost: jest.fn(async () => {}) };
  const open = jest.fn(async () => handle);
  const options = { retentionMs, sessionId: 'SES-test', ownerScope: jest.fn(async () => 'owner-hash'), onStorageError: jest.fn() };
  return { buffer, handle, open, options };
}
test.each([null, undefined])('unset retention uses memory without identity or native storage (%s)', async retention => {
  const f = fixture(); f.options.retentionMs = retention;
  const result = await createRecordingBuffer(f.options, f.open);
  expect(result.mode).toBe('memory');
  expect(f.open).not.toHaveBeenCalled(); expect(f.options.ownerScope).not.toHaveBeenCalled();
});
test.each([0, -1, 1.2, '60000', NaN, Infinity])('invalid configured duration rejects before storage (%s)', async retention => {
  const f = fixture(retention);
  await expect(createRecordingBuffer(f.options, f.open)).rejects.toThrow();
  expect(f.open).not.toHaveBeenCalled();
});
test('binds owner and session and does not fall back on cipher failure', async () => {
  const f = fixture(); f.open.mockRejectedValueOnce(new Error('cipher missing'));
  await expect(createRecordingBuffer(f.options, f.open)).rejects.toThrow('cipher missing');
  expect(f.open).toHaveBeenCalledWith(expect.objectContaining({ ownerScope: 'owner-hash', sessionId: 'SES-test', retentionMs: 60000 }));
});
test('sent but unacknowledged audio is retained on release', async () => {
  const f = fixture(); const result = await createRecordingBuffer(f.options, f.open);
  f.buffer.enqueue({ chunkSeq: 0, capturedAtMs: 1, pcm16: new Uint8Array([1, 2]) });
  f.buffer.drain(() => true);
  expect(await result.release()).toBe('retained');
  expect(f.handle.close).toHaveBeenCalledTimes(1); expect(f.handle.destroy).not.toHaveBeenCalled();
  await result.release(); expect(f.handle.close).toHaveBeenCalledTimes(1);
});
test('empty buffer cleanup failure can be retried', async () => {
  const f = fixture(); const result = await createRecordingBuffer(f.options, f.open);
  await result.confirmDrained();
  f.handle.destroy.mockRejectedValueOnce(new Error('busy'));
  await expect(result.release()).rejects.toThrow('busy');
  expect(await result.release()).toBe('removed');
  expect(f.handle.destroy).toHaveBeenCalledTimes(2);
});

test('releasing unconfigured memory storage clears retained PCM, without claiming gateway delivery', async () => {
  const f = fixture(); f.options.retentionMs = undefined;
  const handle = await createRecordingBuffer(f.options, f.open);
  handle.buffer.enqueue({ chunkSeq: 0, capturedAtMs: 0, pcm16: new Uint8Array([1, 2]) });
  expect(await handle.release()).toBe('memory');
  expect(handle.buffer.bytes()).toBe(0);
  expect(handle.buffer.pending()).toBe(0);
  expect(f.open).not.toHaveBeenCalled();
});
