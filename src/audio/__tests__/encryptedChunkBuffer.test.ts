import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { openEncryptedChunkBuffer } from '../encryptedChunkBuffer';

jest.mock('expo-sqlite', () => ({ openDatabaseSync: jest.fn(), deleteDatabaseSync: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1 }));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: jest.fn(async () => 'a'.repeat(64)), getRandomBytes: () => new Uint8Array(32) }));

beforeEach(() => jest.clearAllMocks());

test('failed close blocks key deletion and is retried before destroying storage', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue('a'.repeat(64));
  const db = { getFirstSync: jest.fn((sql: string) => sql === 'PRAGMA cipher_version' ? { cipher_version: 'test' } : { n: 0 }),
    getAllSync: jest.fn(() => []), runSync: jest.fn(), execSync: jest.fn(),
    closeSync: jest.fn().mockImplementationOnce(() => { throw new Error('busy'); }).mockImplementation(() => {}) };
  jest.mocked(SQLite.openDatabaseSync).mockReturnValue(db as unknown as SQLite.SQLiteDatabase);
  const handle = await openEncryptedChunkBuffer({ ownerScope: 'user', sessionId: 'session', maxChunks: 2, retentionMs: 1000 });
  await expect(handle.destroy()).rejects.toThrow('busy');
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  expect(() => handle.buffer.enqueue({ chunkSeq: 0, capturedAtMs: 1, pcm16: new Uint8Array(2) })).toThrow();
  await handle.destroy();
  expect(db.closeSync).toHaveBeenCalledTimes(2);
  expect(SQLite.deleteDatabaseSync).toHaveBeenCalledTimes(1);
});

test('concurrent destroys share cleanup and failed key deletion remains retryable', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue('a'.repeat(64));
  const db = { getFirstSync: jest.fn((sql: string) => sql === 'PRAGMA cipher_version' ? { cipher_version: 'test' } : { n: 0 }),
    getAllSync: jest.fn(() => []), runSync: jest.fn(), execSync: jest.fn(), closeSync: jest.fn() };
  jest.mocked(SQLite.openDatabaseSync).mockReturnValue(db as unknown as SQLite.SQLiteDatabase);
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('key busy')).mockResolvedValue(undefined);
  const handle = await openEncryptedChunkBuffer({ ownerScope: 'user', sessionId: 'session', maxChunks: 2, retentionMs: 1000 });
  const first = handle.destroy();
  expect(handle.destroy()).toBe(first);
  await expect(first).rejects.toThrow('key busy');
  expect(SQLite.deleteDatabaseSync).not.toHaveBeenCalled();
  await handle.destroy();
  expect(db.closeSync).toHaveBeenCalledTimes(1);
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
  expect(SQLite.deleteDatabaseSync).toHaveBeenCalledTimes(1);
});
test('unset retention refuses before opening storage or reading a key', async () => {
  await expect(openEncryptedChunkBuffer({ ownerScope: 'user-test', sessionId: 'session-test', maxChunks: 2 })).rejects.toThrow('saklama süresi');
  expect(SQLite.openDatabaseSync).not.toHaveBeenCalled();
  expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
});
test('non-SQLCipher build never writes audio tables', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue('a'.repeat(64));
  const db = { getFirstSync: jest.fn(() => null), execSync: jest.fn(), closeSync: jest.fn() };
  jest.mocked(SQLite.openDatabaseSync).mockReturnValue(db as unknown as SQLite.SQLiteDatabase);
  await expect(openEncryptedChunkBuffer({ ownerScope: 'user-test', sessionId: 'session-test', maxChunks: 2, retentionMs: 1000 })).rejects.toThrow('Şifreli depolama');
  expect(db.execSync).not.toHaveBeenCalled(); expect(db.closeSync).toHaveBeenCalledTimes(1);
});

test('destroy closes storage, removes its scoped key/file and forbids further writes', async () => {
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue('a'.repeat(64));
  const db = { getFirstSync: jest.fn((sql: string) => sql === 'PRAGMA cipher_version' ? { cipher_version: 'test' } : { n: 0 }),
    getAllSync: jest.fn(() => []), runSync: jest.fn(), execSync: jest.fn(), closeSync: jest.fn() };
  jest.mocked(SQLite.openDatabaseSync).mockReturnValue(db as unknown as SQLite.SQLiteDatabase);
  const handle = await openEncryptedChunkBuffer({ ownerScope: 'user-test', sessionId: 'session-test', maxChunks: 2, retentionMs: 1000 });
  await handle.destroy(); await handle.destroy();
  expect(db.closeSync).toHaveBeenCalledTimes(1);
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(`audio-buffer-${'a'.repeat(64)}`);
  expect(SQLite.deleteDatabaseSync).toHaveBeenCalledTimes(1);
  expect(() => handle.buffer.enqueue({ chunkSeq: 0, capturedAtMs: Date.now(), pcm16: new Uint8Array(2) })).toThrow();
});
