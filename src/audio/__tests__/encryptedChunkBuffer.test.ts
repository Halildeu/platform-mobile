import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { bufferJournal, BUFFER_JOURNAL_KEY } from '../nativeBufferJournal';
import { openEncryptedChunkBuffer, sweepEncryptedChunkBuffers } from '../encryptedChunkBuffer';
import { createRecordingBuffer } from '../recordingBuffer';

let mockDirectory: string;
jest.mock('expo-sqlite', () => ({ get defaultDatabaseDirectory() { return mockDirectory; }, openDatabaseSync: jest.fn(), deleteDatabaseSync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class {
  path: string;
  constructor(directory: string, file: string) { this.path = jest.requireActual('node:path').join(directory, file); }
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

beforeEach(() => {
  jest.useFakeTimers(); jest.resetAllMocks(); handles = []; stored = new Map();
  directory = mkdtempSync(join(tmpdir(), 'mobile-buffer-test-'));
  mockDirectory = directory;
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
  expect((await bufferJournal.list())[0].state).toBe('lost');
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
  expect((await bufferJournal.list())[0].state).toBe('lost');
});

test('zero pending without drained remains ready and cannot finalize HTTP', async () => {
  const opts = options(); const handle = await openEncryptedChunkBuffer(opts);
  handle.close(); await sweepEncryptedChunkBuffers();
  expect((await bufferJournal.list())[0].state).toBe('ready');
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
  expect((await bufferJournal.list())[0].state).toBe('lost');
});

test('missing key never generates a replacement; orphan audio is removed with loss evidence', async () => {
  const opts = options(); const handle = await openEncryptedChunkBuffer(opts);
  handle.buffer.enqueue(pcm); handle.close(); stored.delete(key(opts.sessionId));
  await sweepEncryptedChunkBuffers();
  expect(SQLite.openDatabaseSync).toHaveBeenCalledTimes(1);
  expect(existsSync(file(opts.sessionId))).toBe(false);
  expect((await bufferJournal.list())[0].state).toBe('lost');
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
  expect((await bufferJournal.list())[0].state).toBe('lost');
});

test('unexpected old file is never overwritten or interpreted as an empty queue', async () => {
  const opts = options(); writeFileSync(file(opts.sessionId), 'legacy encrypted bytes');
  await expect(openEncryptedChunkBuffer(opts)).rejects.toThrow('doğrulanamadı');
  expect(SQLite.openDatabaseSync).not.toHaveBeenCalled();
  expect((await bufferJournal.list())[0].state).toBe('lost');
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
  expect((await bufferJournal.list()).find(r => r.sessionId === second.sessionId)?.state).toBe('lost');
});

test('auxiliary SQLite files are removed after confirmed close; loss evidence survives', async () => {
  const opts = options(); const handle = await openEncryptedChunkBuffer(opts);
  handle.buffer.enqueue(pcm); handle.close();
  stored.delete(key(opts.sessionId));
  for (const suffix of ['-wal', '-shm', '-journal']) writeFileSync(file(opts.sessionId) + suffix, 'orphan bytes');
  await sweepEncryptedChunkBuffers();
  for (const suffix of ['', '-wal', '-shm', '-journal']) expect(existsSync(file(opts.sessionId) + suffix)).toBe(false);
  expect((await bufferJournal.list())[0].state).toBe('lost');
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
  await expect(openEncryptedChunkBuffer(opts)).rejects.toThrow('Şifreli ses deposu işlemi doğrulanamadı');
  expect(close).toHaveBeenCalledTimes(1);
  expect((await bufferJournal.list())[0].state).toBe('creating');
  await sweepEncryptedChunkBuffers();
});
