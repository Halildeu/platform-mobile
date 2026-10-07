import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { bufferJournal, BUFFER_JOURNAL_KEY, BUFFER_LOSS_KEY } from '../nativeBufferJournal';
import { discardAbandonedBuffer, discardOwnerAudioBuffers, openEncryptedChunkBuffer, reopenEncryptedChunkBuffer, sweepEncryptedChunkBuffers } from '../encryptedChunkBuffer';
import { replayPendingAudio } from '../pendingAudioReplay';
import type { LiveSocket } from '../foregroundStream';
import { createRecordingBuffer, prepareRecordingStorage } from '../recordingBuffer';

let mockDirectory: string;
let mockNativeDirectory: string;
jest.mock('expo-sqlite', () => ({ get defaultDatabaseDirectory() { return mockNativeDirectory; }, openDatabaseSync: jest.fn(), deleteDatabaseSync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class {
  path: string;
  constructor(directory: string, file: string) {
    // Expo Android delegates to java.io.File(URI), which rejects a bare POSIX path.
    // Do not let a permissive Node path mock hide the actual device boundary.
    if (!directory.startsWith('file:///')) throw new Error('URI is not absolute');
    const decoded = decodeURIComponent(directory.slice('file://'.length));
    if (decoded !== mockNativeDirectory) throw new Error('Wrong native directory');
    this.path = jest.requireActual('node:path').join(mockDirectory, file);
  }
  get exists() { return jest.requireActual('node:fs').existsSync(this.path); }
  delete() { jest.requireActual('node:fs').rmSync(this.path); }
} }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1 }));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: async (_algo: string, value: string) =>
  jest.requireActual('node:crypto').createHash('sha256').update(value).digest('hex'), getRandomBytes: () => new Uint8Array(32) }));

let directory: string;
let stored: Map<string, string>;
let sessionCounter = 0;
let handles: { db: DatabaseSync; close: jest.Mock }[];
const ownerScope = 'a'.repeat(64);
const options = () => ({ ownerScope, sessionId: `SES-test-${++sessionCounter}`, maxChunks: 2, retentionMs: 1000 });
const pcm = { chunkSeq: 0, capturedAtMs: 1, pcm16: new Uint8Array([1, 2]) };
const identity = (sessionId: string) => createHash('sha256').update(JSON.stringify([ownerScope, sessionId])).digest('hex');
const file = (sessionId: string) => join(directory, `audio-${identity(sessionId)}.db`);
const key = (sessionId: string) => `audio-buffer-${identity(sessionId)}`;
async function expectLoss(sessionId: string) {
  const active = (await bufferJournal.list()).find(row => row.sessionId === sessionId);
  expect(active?.state === 'lost' || await bufferJournal.hasLoss(ownerScope, sessionId)).toBe(true);
  await expect(bufferJournal.assertFinishAllowed(ownerScope, sessionId)).rejects.toThrow('Bekleyen');
}


beforeEach(() => {
  jest.useFakeTimers(); jest.resetAllMocks(); handles = []; stored = new Map();
  directory = mkdtempSync(join(tmpdir(), 'mobile-buffer-test-'));
  mockDirectory = directory;
  mockNativeDirectory = '/data/user/0/com.workcube.meeting/files/SQLite';
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async name => stored.get(name) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (name, value) => { stored.set(name, value); });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async name => { stored.delete(name); });
  jest.mocked(SQLite.deleteDatabaseSync).mockImplementation(name => { rmSync(join(directory, name), { force: true }); });
  jest.mocked(SQLite.openDatabaseSync).mockImplementation(name => {
    const db = new DatabaseSync(join(directory, name));
    const close = jest.fn(() => db.close()); handles.push({ db, close });
    const adapter = {
      // Real SQLite tests ordering/transactions/reopen; SQLCipher itself requires a native package.
      getFirstSync: (sql: string, params: (string | number | null | Uint8Array)[] = []) =>
        sql === 'PRAGMA cipher_version' ? { cipher_version: 'synthetic-cipher-capability' } : db.prepare(sql).get(...params) ?? null,
      getAllSync: (sql: string, params: (string | number | null | Uint8Array)[] = []) => db.prepare(sql).all(...params),
      runSync: (sql: string, params: (string | number | null | Uint8Array)[] = []) => { db.prepare(sql).run(...params); },
      execSync: (sql: string) => { db.exec(sql); }, closeSync: close,
    };
    return adapter as unknown as SQLite.SQLiteDatabase;
  });
});

test.each([
  '/data/user/0/com.workcube.meeting/files/SQLite',
  '/var/mobile/Containers/Data/Application/Örnek % #?/Library/SQLite',
])('encrypted recording opens, reopens and cleans up with native database directory %s', async nativeDirectory => {
  mockNativeDirectory = nativeDirectory;
  const opts = options();
  const handle = await createRecordingBuffer({ ...opts, ownerScope: async () => ownerScope, onStorageError: jest.fn() }, openEncryptedChunkBuffer);
  handle.buffer.enqueue(pcm);
  expect(await handle.release()).toBe('retained');
  const recovered = await reopenEncryptedChunkBuffer(opts);
  expect(recovered.buffer.pending()).toBe(1);
  recovered.close();
  await discardAbandonedBuffer(ownerScope, opts.sessionId);
  expect(existsSync(file(opts.sessionId))).toBe(false);
  expect(await bufferJournal.list()).toEqual([]);
});
afterEach(() => {
  for (const item of handles) { try { item.db.close(); } catch {} }
  jest.useRealTimers();
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('mobile-buffer-test-')) throw new Error('Unsafe fixture path');
  rmSync(target, { recursive: true, force: true });
});

test.each(['close', 'key', 'file'] as const)('drained release retries %s without reading closed storage', async failure => {
  const opts = options();
  const handle = await createRecordingBuffer({ ...opts, ownerScope: async () => ownerScope, onStorageError: jest.fn() }, openEncryptedChunkBuffer);
  await handle.confirmDrained();
  if (failure === 'close') handles[0].close.mockImplementationOnce(() => { throw new Error('cleanup busy'); });
  if (failure === 'key') jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('cleanup busy'));
  if (failure === 'file') jest.mocked(SQLite.deleteDatabaseSync).mockImplementationOnce(() => { throw new Error('cleanup busy'); });
  await expect(handle.release()).rejects.toThrow('doğrulanamadı');
  expect(() => handle.buffer.pending()).toThrow('kapalı');
  expect(bufferJournal.acquire(identity(opts.sessionId))).toBeNull();
  await expect(handle.release()).resolves.toBe('removed');
  await expect(handle.release()).resolves.toBe('removed');
  expect(handles[0].close).toHaveBeenCalledTimes(failure === 'close' ? 2 : 1);
  expect(await bufferJournal.list()).toEqual([]);
});

test('unacknowledged close is retryable and startup sweep respects original TTL', async () => {
  const opts = options();
  const handle = await createRecordingBuffer({ ...opts, ownerScope: async () => ownerScope, onStorageError: jest.fn() }, openEncryptedChunkBuffer);
  handle.buffer.enqueue(pcm);
  handles[0].close.mockImplementationOnce(() => { throw new Error('busy'); });
  await expect(handle.release()).rejects.toThrow('doğrulanamadı');
  await sweepEncryptedChunkBuffers(); // leased by the original handle, never reopened
  expect(SQLite.openDatabaseSync).toHaveBeenCalledTimes(1);
  expect(await handle.release()).toBe('retained');
  await sweepEncryptedChunkBuffers();
  expect(existsSync(file(opts.sessionId))).toBe(true);
  jest.setSystemTime(Date.now() + 1001);
  await sweepEncryptedChunkBuffers();
  expect(existsSync(file(opts.sessionId))).toBe(false);
  expect(stored.has(key(opts.sessionId))).toBe(false);
  await expectLoss(opts.sessionId);
  await expect(bufferJournal.assertFinishAllowed(ownerScope, opts.sessionId)).rejects.toThrow('Bekleyen');
  const writes = jest.mocked(SecureStore.setItemAsync).mock.calls.length;
  await sweepEncryptedChunkBuffers();
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(writes); // idempotent tombstone
});

test('TTL-empty release retains loss tombstone even after failed cleanup', async () => {
  const opts = options();
  const handle = await createRecordingBuffer({ ...opts, ownerScope: async () => ownerScope, onStorageError: jest.fn() }, openEncryptedChunkBuffer);
  handle.buffer.enqueue(pcm);
  jest.advanceTimersByTime(1001);
  expect(handle.buffer.pending()).toBe(0);
  expect(handle.buffer.purged()).toBe(1);
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('locked'));
  await expect(handle.release()).rejects.toThrow('doğrulanamadı');
  await expect(handle.release()).resolves.toBe('lost');
  await expectLoss(opts.sessionId);
});

test('closed zero-pending without drain archives unverified history and cannot finalize HTTP', async () => {
  const opts = options(); const handle = await openEncryptedChunkBuffer(opts);
  handle.close(); await sweepEncryptedChunkBuffers();
  expect(await bufferJournal.list()).toEqual([]);
  expect(await bufferJournal.hasLoss(ownerScope, opts.sessionId)).toBe(true);
  await expect(bufferJournal.assertFinishAllowed(ownerScope, opts.sessionId)).rejects.toThrow('Bekleyen');
});

test('markDrained seals capture before journal write completes', async () => {
  const opts = options(); const handle = await openEncryptedChunkBuffer(opts);
  const write = jest.mocked(SecureStore.setItemAsync).getMockImplementation()!;
  let mutationRejected = false;
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (name, value, config) => {
    if (name === BUFFER_JOURNAL_KEY && value.includes('"drained"')) {
      try { handle.buffer.enqueue(pcm); } catch { mutationRejected = true; }
    }
    return write(name, value, config);
  });
  await handle.confirmDrained();
  expect(mutationRejected).toBe(true);
  await handle.destroy();
});

test('missing original file never creates a blank replacement', async () => {
  const opts = options(); const handle = await openEncryptedChunkBuffer(opts);
  handle.buffer.enqueue(pcm); handle.close(); rmSync(file(opts.sessionId));
  const opens = jest.mocked(SQLite.openDatabaseSync).mock.calls.length;
  await sweepEncryptedChunkBuffers();
  expect(SQLite.openDatabaseSync).toHaveBeenCalledTimes(opens);
  await expectLoss(opts.sessionId);
});

test('missing key never generates a replacement; orphan audio is removed with loss evidence', async () => {
  const opts = options(); const handle = await openEncryptedChunkBuffer(opts);
  handle.buffer.enqueue(pcm); handle.close(); stored.delete(key(opts.sessionId));
  await sweepEncryptedChunkBuffers();
  expect(SQLite.openDatabaseSync).toHaveBeenCalledTimes(1);
  expect(existsSync(file(opts.sessionId))).toBe(false);
  await expectLoss(opts.sessionId);
});

test('creating intent survives key write failure and is cleaned on next execution', async () => {
  const opts = options(); const write = jest.mocked(SecureStore.setItemAsync).getMockImplementation()!;
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (name, value, config) => {
    if (name === key(opts.sessionId)) throw new Error('locked');
    return write(name, value, config);
  });
  await expect(openEncryptedChunkBuffer(opts)).rejects.toThrow('doğrulanamadı');
  expect((await bufferJournal.list())[0].state).toBe('creating');
  expect(SQLite.openDatabaseSync).not.toHaveBeenCalled();
  await sweepEncryptedChunkBuffers();
  await expectLoss(opts.sessionId);
});

test('pre-microphone URI failure from the previous APK can be cleaned without inventing delivery', async () => {
  const opts = options();
  stored.set(BUFFER_JOURNAL_KEY, JSON.stringify({ version: 1, records: [{
    id: identity(opts.sessionId), ownerHash: ownerScope, sessionId: opts.sessionId,
    retentionMs: opts.retentionMs, state: 'creating',
  }] }));
  await sweepEncryptedChunkBuffers();
  expect(SQLite.openDatabaseSync).not.toHaveBeenCalled();
  await expectLoss(opts.sessionId);
  await expect(bufferJournal.assertFinishAllowed(ownerScope, opts.sessionId)).rejects.toThrow('Bekleyen');
  // The normal explicit-abandon flow calls this only after server acknowledgements.
  await discardAbandonedBuffer(ownerScope, opts.sessionId);
  expect(await bufferJournal.list()).toEqual([]);
  const next = await openEncryptedChunkBuffer(options());
  await next.confirmDrained(); await next.destroy();
  expect(await bufferJournal.list()).toEqual([]);
});

test('unexpected old file is never overwritten or interpreted as an empty queue', async () => {
  const opts = options(); writeFileSync(file(opts.sessionId), 'legacy encrypted bytes');
  await expect(openEncryptedChunkBuffer(opts)).rejects.toThrow('doğrulanamadı');
  expect(SQLite.openDatabaseSync).not.toHaveBeenCalled();
  await expectLoss(opts.sessionId);
  await sweepEncryptedChunkBuffers();
});

test('concurrent open is rejected before a second database or key is created', async () => {
  const opts = options(); const handle = await openEncryptedChunkBuffer(opts);
  await expect(openEncryptedChunkBuffer(opts)).rejects.toThrow('başka bir işlem');
  expect(SQLite.openDatabaseSync).toHaveBeenCalledTimes(1);
  await handle.confirmDrained(); await handle.destroy();
});

test('unset retention refuses before any native storage access', async () => {
  await expect(openEncryptedChunkBuffer({ ...options(), retentionMs: undefined })).rejects.toThrow('saklama süresi');
  expect(SQLite.openDatabaseSync).not.toHaveBeenCalled(); expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
});

test('drain proof retries a pre-commit SecureStore failure without mutating sealed queue', async () => {
  const opts = options(); const handle = await openEncryptedChunkBuffer(opts);
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('write failed'));
  await expect(handle.confirmDrained()).rejects.toThrow('doğrulanamadı');
  expect((await bufferJournal.list())[0].state).toBe('ready');
  expect(() => handle.buffer.enqueue(pcm)).toThrow('kapanışı');
  await handle.confirmDrained();
  expect((await bufferJournal.list())[0].state).toBe('drained');
  await handle.destroy();
});

test('final deletion readback failure remains retryable after journal removal committed', async () => {
  const opts = options(); const handle = await openEncryptedChunkBuffer(opts);
  await handle.confirmDrained();
  const write = jest.mocked(SecureStore.setItemAsync).getMockImplementation()!;
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (name, value, config) => {
    await write(name, value, config);
    if (name === BUFFER_JOURNAL_KEY && value.includes('"records":[]')) {
      jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('readback locked'));
    }
  });
  await expect(handle.destroy()).rejects.toThrow('doğrulanamadı');
  expect(existsSync(file(opts.sessionId))).toBe(false);
  await expect(handle.destroy()).resolves.toBeUndefined();
  expect(await bufferJournal.list()).toEqual([]);
});

test('a corrupt first database does not starve other expired session cleanup', async () => {
  const first = options(); const second = options();
  const one = await openEncryptedChunkBuffer(first); one.buffer.enqueue(pcm); one.close();
  const two = await openEncryptedChunkBuffer(second); two.buffer.enqueue(pcm); two.close();
  writeFileSync(file(first.sessionId), 'corrupt SQLite');
  jest.setSystemTime(Date.now() + 1001);
  await expect(sweepEncryptedChunkBuffers()).rejects.toThrow('Bazı');
  expect(existsSync(file(first.sessionId))).toBe(true); // do not discard unverified state
  expect(existsSync(file(second.sessionId))).toBe(false);
  await expectLoss(second.sessionId);
});

test('auxiliary SQLite files are removed after confirmed close; loss evidence survives', async () => {
  const opts = options(); const handle = await openEncryptedChunkBuffer(opts);
  handle.buffer.enqueue(pcm); handle.close();
  stored.delete(key(opts.sessionId));
  for (const suffix of ['-wal', '-shm', '-journal']) writeFileSync(file(opts.sessionId) + suffix, 'orphan bytes');
  await sweepEncryptedChunkBuffers();
  for (const suffix of ['', '-wal', '-shm', '-journal']) expect(existsSync(file(opts.sessionId) + suffix)).toBe(false);
  await expectLoss(opts.sessionId);
});

test('lost tombstone publication failure cannot erase files or admit HTTP finish', async () => {
  const opts = options(); const handle = await createRecordingBuffer({ ...opts, ownerScope: async () => ownerScope,
    onStorageError: jest.fn() }, openEncryptedChunkBuffer);
  handle.buffer.enqueue(pcm); jest.advanceTimersByTime(1001);
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('journal unavailable'));
  await expect(handle.release()).rejects.toThrow('doğrulanamadı');
  expect(existsSync(file(opts.sessionId))).toBe(true);
  await expect(bufferJournal.assertFinishAllowed(ownerScope, opts.sessionId)).rejects.toThrow('Bekleyen');
  await expect(handle.release()).resolves.toBe('lost');
});

test('native SQL/key error text is never returned to the screen', async () => {
  const opts = options();
  const close = jest.fn();
  jest.mocked(SQLite.openDatabaseSync).mockReturnValueOnce({
    getFirstSync: () => ({ cipher_version: 'synthetic' }), closeSync: close,
    execSync: () => { throw new Error('PRAGMA key PRIVATE_SYNTHETIC_KEY'); },
  } as unknown as SQLite.SQLiteDatabase);
  await expect(openEncryptedChunkBuffer(opts)).rejects.toThrow('AUDIO_UNLOCK');
  expect(close).toHaveBeenCalledTimes(1);
  expect((await bufferJournal.list())[0].state).toBe('creating');
  await sweepEncryptedChunkBuffers();
});

test('four retained records reject a fifth with a capacity code, without opening a DB or overwriting keys', async () => {
  for (let i = 0; i < 4; i++) {
    const handle = await openEncryptedChunkBuffer(options()); handle.buffer.enqueue(pcm); handle.close();
  }
  const before = new Map(stored);
  const opens = jest.mocked(SQLite.openDatabaseSync).mock.calls.length;
  await expect(prepareRecordingStorage(900000, sweepEncryptedChunkBuffers)).rejects.toThrow('AUDIO_CAPACITY');
  await expect(openEncryptedChunkBuffer(options())).rejects.toThrow('AUDIO_CAPACITY');
  expect(stored).toEqual(before);
  expect(SQLite.openDatabaseSync).toHaveBeenCalledTimes(opens + 4); // cleanup reopens originals, never a fifth file
});

test('preflight journal access failure never exposes native error details', async () => {
  jest.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('PRIVATE_KEY_PATH'));
  const error = await prepareRecordingStorage(900000, sweepEncryptedChunkBuffers).catch(e => e);
  expect(error.message).toContain('AUDIO_JOURNAL');
  expect(error.message).not.toContain('PRIVATE_KEY_PATH');
  expect(SQLite.openDatabaseSync).not.toHaveBeenCalled();
});

test.each(['key', 'open', 'cipher', 'schema'] as const)('startup %s failures expose only a fixed code and release the lease', async failure => {
  const opts = options();
  const secret = 'PRIVATE_NATIVE_SQL_KEY_PATH';
  const expected = { key: 'AUDIO_KEY_WRITE', open: 'AUDIO_DATABASE', cipher: 'AUDIO_CIPHER', schema: 'AUDIO_SCHEMA' }[failure];
  if (failure === 'key') {
    const original = jest.mocked(SecureStore.setItemAsync).getMockImplementation()!;
    jest.mocked(SecureStore.setItemAsync).mockImplementation(async (name, value, config) => {
      if (name.startsWith('audio-buffer-')) throw new Error(secret);
      return original(name, value, config);
    });
  } else if (failure === 'open') jest.mocked(SQLite.openDatabaseSync).mockImplementationOnce(() => { throw new Error(secret); });
  else jest.mocked(SQLite.openDatabaseSync).mockReturnValueOnce({
    getFirstSync: () => failure === 'cipher' ? null : { cipher_version: 'synthetic' },
    execSync: (sql: string) => { if (sql.startsWith('CREATE')) throw new Error(secret); }, closeSync: jest.fn(),
  } as unknown as SQLite.SQLiteDatabase);
  const error = await openEncryptedChunkBuffer(opts).catch(e => e);
  expect(error.message).toContain(expected);
  expect(error.message).not.toContain(secret);
  const lease = bufferJournal.acquire(identity(opts.sessionId));
  expect(lease).not.toBeNull(); bufferJournal.release(identity(opts.sessionId), lease!);
});

test('reopen preserves original identity, bytes, timestamps and TTL and disallows new capture', async () => {
  const opts = options(); const fresh = await openEncryptedChunkBuffer(opts);
  fresh.buffer.enqueue({ ...pcm, chunkSeq: 77 }); fresh.close();
  const original = new DatabaseSync(file(opts.sessionId));
  const row = original.prepare('SELECT * FROM pending_audio_chunks').get(); original.close();
  const writes = jest.mocked(SecureStore.setItemAsync).mock.calls.length;
  const reopened = await reopenEncryptedChunkBuffer({ ownerScope, sessionId: opts.sessionId, maxChunks: 2 });
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(writes);
  expect(reopened).not.toHaveProperty('confirmDrained'); expect(reopened).not.toHaveProperty('destroy');
  expect(() => reopened.buffer.enqueue(pcm)).toThrow('yeni ses');
  const sent: unknown[] = []; reopened.buffer.drain(value => { sent.push(value); return true; });
  expect(sent).toEqual([{ chunkSeq: 77, capturedAtMs: 1, pcm16: pcm.pcm16, enqueuedAtMs: row!.enqueued_at_ms }]);
  reopened.close();
  jest.setSystemTime(Number(row!.enqueued_at_ms) + 1001);
  await expect(reopenEncryptedChunkBuffer({ ownerScope, sessionId: opts.sessionId, maxChunks: 2 })).rejects.toThrow('doğrulanamadı');
  await expectLoss(opts.sessionId);
  await sweepEncryptedChunkBuffers(); expect(existsSync(file(opts.sessionId))).toBe(false);
});

test.each(['owner', 'session', 'key', 'file', 'lost', 'drained', 'creating', 'deleting'] as const)(
  'recovery rejects %s mismatch/state before opening native storage', async failure => {
    const opts = options(); const handle = await openEncryptedChunkBuffer(opts); handle.buffer.enqueue(pcm); handle.close();
    let restoreOwner = ownerScope; let sessionId = opts.sessionId;
    if (failure === 'owner') restoreOwner = 'b'.repeat(64);
    else if (failure === 'session') sessionId += '-foreign';
    else if (failure === 'key') stored.delete(key(sessionId));
    else if (failure === 'file') rmSync(file(sessionId));
    else {
      const id = identity(sessionId); const lease = bufferJournal.acquire(id)!;
      await bufferJournal.edit(id, lease, row => ({ ...row!, state: failure,
        ...(failure === 'deleting' ? { outcome: 'lost' as const } : {}) }));
      bufferJournal.release(id, lease);
    }
    await expect(reopenEncryptedChunkBuffer({ ownerScope: restoreOwner, sessionId, maxChunks: 2 })).rejects.toThrow('doğrulanamadı');
    expect(SQLite.openDatabaseSync).toHaveBeenCalledTimes(1);
    const id = await bufferJournal.identity(restoreOwner, sessionId); const lease = bufferJournal.acquire(id)!;
    expect(lease).not.toBeNull(); bufferJournal.release(id, lease);
  });

test.each(['table', 'loss-table', 'loss-row', 'seq', 'captured', 'enqueued', 'blob', 'loss'] as const)(
  'recovery fails closed on damaged %s without repairing it', async failure => {
    const opts = options(); const handle = await openEncryptedChunkBuffer(opts); handle.buffer.enqueue(pcm); handle.close();
    const sql: Record<typeof failure, string> = {
      table: 'DROP TABLE pending_audio_chunks', 'loss-table': 'DROP TABLE audio_buffer_loss',
      'loss-row': 'DELETE FROM audio_buffer_loss', seq: 'UPDATE pending_audio_chunks SET chunk_seq = -1',
      captured: 'UPDATE pending_audio_chunks SET captured_at_ms = -1',
      enqueued: 'UPDATE pending_audio_chunks SET enqueued_at_ms = -1',
      blob: "UPDATE pending_audio_chunks SET pcm16 = X'01'", loss: 'UPDATE audio_buffer_loss SET expired = 1',
    };
    const db = new DatabaseSync(file(opts.sessionId)); db.exec(sql[failure]); db.close();
    await expect(reopenEncryptedChunkBuffer({ ownerScope, sessionId: opts.sessionId, maxChunks: 2 })).rejects.toThrow('doğrulanamadı');
    expect(handles[1].close).toHaveBeenCalledTimes(1);
    await expect(bufferJournal.assertFinishAllowed(ownerScope, opts.sessionId)).rejects.toThrow('Bekleyen');
    if (failure === 'table' || failure === 'loss-table' || failure === 'loss-row') {
      const check = new DatabaseSync(file(opts.sessionId));
      if (failure === 'loss-row') expect(check.prepare('SELECT * FROM audio_buffer_loss').all()).toEqual([]);
      else expect(check.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(
        failure === 'table' ? 'pending_audio_chunks' : 'audio_buffer_loss')).toBeUndefined();
      check.close();
    }
  });

test('recovery owns one lease through native-close failure and retries exact handle', async () => {
  const opts = options(); const initial = await openEncryptedChunkBuffer(opts); initial.close();
  const recovered = await reopenEncryptedChunkBuffer({ ownerScope, sessionId: opts.sessionId, maxChunks: 2 });
  handles[1].close.mockImplementationOnce(() => { throw new Error('busy'); });
  expect(() => recovered.close()).toThrow('doğrulanamadı');
  await expect(reopenEncryptedChunkBuffer({ ownerScope, sessionId: opts.sessionId, maxChunks: 2 })).rejects.toThrow('başka bir işlem');
  await sweepEncryptedChunkBuffers(); expect(SQLite.openDatabaseSync).toHaveBeenCalledTimes(2);
  recovered.close(); expect(handles[1].close).toHaveBeenCalledTimes(2);
});

test('recovered gateway drain cannot grant canonical finish, even after reopen and sweep', async () => {
  const opts = options(); const initial = await openEncryptedChunkBuffer(opts); initial.buffer.enqueue(pcm); initial.close();
  const recovered = await reopenEncryptedChunkBuffer({ ownerScope, sessionId: opts.sessionId, maxChunks: 2 });
  const ws: LiveSocket = { readyState: 1, bufferedAmount: 0, onopen: null, onmessage: null, onerror: null,
    onclose: null, send: jest.fn(), close: jest.fn() };
  const attempt = replayPendingAudio(ws, recovered.buffer);
  ws.onmessage?.({ data: '{"type":"ready"}' }); await jest.advanceTimersByTimeAsync(250);
  ws.onmessage?.({ data: '{"type":"audio_ack","chunk_seq":0}' });
  ws.onmessage?.({ data: '{"type":"drained"}' });
  expect(await attempt.result).toEqual({ state: 'gateway-drained', historyComplete: false });
  expect(recovered.buffer.pending()).toBe(0); recovered.close(); await sweepEncryptedChunkBuffers();
  expect(await bufferJournal.list()).toEqual([]);
  expect(await bufferJournal.hasLoss(ownerScope, opts.sessionId)).toBe(true);
  await expect(bufferJournal.assertFinishAllowed(ownerScope, opts.sessionId)).rejects.toThrow('Bekleyen');
});

test('startup cleanup cannot manufacture a missing queue table and pass future recovery', async () => {
  const opts = options(); const initial = await openEncryptedChunkBuffer(opts); initial.close();
  const db = new DatabaseSync(file(opts.sessionId)); db.exec('DROP TABLE pending_audio_chunks'); db.close();
  await expect(sweepEncryptedChunkBuffers()).rejects.toThrow('Bazı');
  await expect(reopenEncryptedChunkBuffer({ ownerScope, sessionId: opts.sessionId, maxChunks: 2 })).rejects.toThrow('doğrulanamadı');
});

test('explicit abandonment erases retained audio only after releasing its native handle', async () => {
  const o = options(); const handle = await openEncryptedChunkBuffer(o);
  handle.buffer.enqueue(pcm);
  await expect(discardAbandonedBuffer(ownerScope, o.sessionId)).rejects.toThrow();
  expect(existsSync(file(o.sessionId))).toBe(true);
  handle.close();
  await discardAbandonedBuffer(ownerScope, o.sessionId);
  expect(existsSync(file(o.sessionId))).toBe(false); expect(stored.has(key(o.sessionId))).toBe(false);
  expect((await bufferJournal.list()).some(row => row.sessionId === o.sessionId)).toBe(false);
  await discardAbandonedBuffer(ownerScope, o.sessionId);
});

test('logout cleanup erases every retained buffer for the signed-in owner', async () => {
  const first = options(); const second = options();
  const firstHandle = await openEncryptedChunkBuffer(first);
  const secondHandle = await openEncryptedChunkBuffer(second);
  firstHandle.buffer.enqueue(pcm); secondHandle.buffer.enqueue({ ...pcm, chunkSeq: 1 });
  firstHandle.close(); secondHandle.close();

  await expect(discardOwnerAudioBuffers(ownerScope)).resolves.toBe(true);
  expect(existsSync(file(first.sessionId))).toBe(false);
  expect(existsSync(file(second.sessionId))).toBe(false);
  expect(await bufferJournal.list()).toEqual([]);
});

test('legacy four lost tombstones migrate before startup; a fifth recording opens and all old finishes remain blocked', async () => {
  const old = Array.from({ length: 4 }, () => options());
  stored.set(BUFFER_JOURNAL_KEY, JSON.stringify({ version: 1, records: old.map(o => ({
    id: identity(o.sessionId), ownerHash: ownerScope, sessionId: o.sessionId, retentionMs: o.retentionMs, state: 'lost',
  })) }));
  await prepareRecordingStorage(900000, sweepEncryptedChunkBuffers);
  expect(await bufferJournal.list()).toEqual([]);
  expect(await bufferJournal.lossHistory()).toHaveLength(4);
  for (const o of old) await expect(bufferJournal.assertFinishAllowed(ownerScope, o.sessionId)).rejects.toThrow('Bekleyen');
  const next = await openEncryptedChunkBuffer(options());
  next.buffer.enqueue(pcm);
  expect(next.buffer.pending()).toBe(1);
  next.close();
  expect(await bufferJournal.lossHistory()).toHaveLength(4);
});

test('four expired buffers release capture slots without losing loss evidence', async () => {
  const old = Array.from({ length: 4 }, () => options());
  for (const o of old) { const handle = await openEncryptedChunkBuffer(o); handle.buffer.enqueue(pcm); handle.close(); }
  jest.setSystemTime(Date.now() + 1001);
  await prepareRecordingStorage(900000, sweepEncryptedChunkBuffers);
  expect(await bufferJournal.list()).toEqual([]);
  for (const o of old) {
    expect(existsSync(file(o.sessionId))).toBe(false);
    expect(stored.has(key(o.sessionId))).toBe(false);
    expect(await bufferJournal.hasLoss(ownerScope, o.sessionId)).toBe(true);
  }
});

test('loss archival failure retains its reserved slot; retry frees it after durable history verification', async () => {
  const o = options(); const handle = await openEncryptedChunkBuffer(o); handle.buffer.enqueue(pcm); handle.close();
  jest.setSystemTime(Date.now() + 1001);
  const write = jest.mocked(SecureStore.setItemAsync).getMockImplementation()!;
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (name, value, config) => {
    if (name === BUFFER_LOSS_KEY) throw new Error('locked');
    return write(name, value, config);
  });
  await expect(sweepEncryptedChunkBuffers()).rejects.toThrow();
  expect((await bufferJournal.list())[0].state).toBe('lost');
  await expect(bufferJournal.assertFinishAllowed(ownerScope, o.sessionId)).rejects.toThrow();
  jest.mocked(SecureStore.setItemAsync).mockImplementation(write);
  await sweepEncryptedChunkBuffers();
  expect(await bufferJournal.list()).toEqual([]);
  expect(await bufferJournal.hasLoss(ownerScope, o.sessionId)).toBe(true);
  await discardAbandonedBuffer(ownerScope, o.sessionId);
  expect(await bufferJournal.hasLoss(ownerScope, o.sessionId)).toBe(false);
});

test('owner logout clears archived history as well as live audio, while preserving other owners', async () => {
  const first = options(); const handle = await openEncryptedChunkBuffer(first); handle.close();
  const other = { ...options(), ownerScope: 'b'.repeat(64) };
  const otherHandle = await openEncryptedChunkBuffer(other); otherHandle.close();
  await sweepEncryptedChunkBuffers();
  expect(await bufferJournal.lossHistory()).toHaveLength(2);
  await discardOwnerAudioBuffers(ownerScope);
  expect(await bufferJournal.lossHistory()).toHaveLength(1);
  expect(await bufferJournal.hasLoss(other.ownerScope, other.sessionId)).toBe(true);
});

test('explicit acknowledged abandonment can clean an active slot even when loss history is full', async () => {
  const o = options(); const handle = await openEncryptedChunkBuffer(o); handle.buffer.enqueue(pcm); handle.close();
  const ids = Array.from({ length: 20 }, (_, i) => identity(`SES-prior-${i}`));
  stored.set(BUFFER_LOSS_KEY, JSON.stringify({ version: 1, owners: { [ownerScope]: ids } }));
  await discardAbandonedBuffer(ownerScope, o.sessionId);
  expect(await bufferJournal.list()).toEqual([]);
  expect(await bufferJournal.lossHistory()).toHaveLength(20);
  expect(existsSync(file(o.sessionId))).toBe(false);
});
