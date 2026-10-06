import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { OfflineAudioBuffer } from './offlineBuffer';
import { SqliteChunkStore, type SqliteLike } from './sqliteChunkStore';
import { bufferJournal } from './nativeBufferJournal';
import type { BufferRecord } from './audioBufferJournal';
import { databaseFileUri } from '../diagnostics/databaseFileUri';

const keyName = (id: string) => `audio-buffer-${id}`;
const fileName = (id: string) => `audio-${id}.db`;
// SQLite returns a native absolute path. File requires a file:// URI on-device.
// Apply the same conversion to creation, recovery and every sidecar cleanup.
const databaseDirectory = () => databaseFileUri(SQLite.defaultDatabaseDirectory);
const fileExists = (id: string) => new File(databaseDirectory(), fileName(id)).exists;
const sidecars = (id: string) => ['-wal', '-shm', '-journal'].map(suffix => new File(databaseDirectory(), fileName(id) + suffix));
const anyFileExists = (id: string) => fileExists(id) || sidecars(id).some(file => file.exists);
// Failed native close holds the lease. Retry that exact handle, never open another one.
const failedOpens = new Map<string, () => void>();
const storageFailure = () => new Error('Şifreli ses deposu işlemi doğrulanamadı; yeniden deneyin.');

export function validateBufferPolicy(retentionMs: number | undefined, maxChunks: number): void {
  if (!Number.isSafeInteger(retentionMs) || (retentionMs ?? 0) <= 0) {
    throw new Error('Ses saklama süresi yapılandırılmadı; kalıcı tampon açılamaz.');
  }
  if (!Number.isSafeInteger(maxChunks) || maxChunks <= 0) throw new Error('Geçersiz tampon sınırı.');
}

function unlock(db: SQLite.SQLiteDatabase, key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Ses tamponu anahtarı geçersiz.');
  const cipher = db.getFirstSync<{ cipher_version: string }>('PRAGMA cipher_version');
  if (!cipher?.cipher_version) throw new Error('Şifreli depolama bu uygulama sürümünde yok.');
  db.execSync(`PRAGMA key = "x'${key}'"`);
  db.execSync('PRAGMA secure_delete = ON;');
}

/** Must hold a lease with a successfully closed DB before removing any key/file. */
async function eraseFiles(record: BufferRecord, lease: symbol): Promise<void> {
  // Final journal removal may have committed before its verification read failed.
  if (!(await bufferJournal.list()).some(row => row.id === record.id) && record.state === 'drained' &&
      !anyFileExists(record.id) && await SecureStore.getItemAsync(keyName(record.id)) === null) return;
  await bufferJournal.edit(record.id, lease, row => {
    if (!row || !['lost', 'drained', 'deleting'].includes(row.state)) throw new Error('Ses kaydı silinmeye hazır değil.');
    const outcome = row.state === 'deleting' ? row.outcome! : row.state as 'lost' | 'drained';
    return { ...row, state: 'deleting', outcome };
  });
  await SecureStore.deleteItemAsync(keyName(record.id));
  if (await SecureStore.getItemAsync(keyName(record.id)) !== null) throw new Error('Ses anahtarı silinemedi.');
  if (fileExists(record.id)) SQLite.deleteDatabaseSync(fileName(record.id));
  for (const file of sidecars(record.id)) { if (file.exists) file.delete(); }
  if (anyFileExists(record.id)) throw new Error('Ses dosyası silinemedi.');
  await bufferJournal.edit(record.id, lease, row => {
    if (!row || row.state !== 'deleting') throw new Error('Ses temizleme kaydı okunamadı.');
    if (row.outcome === 'drained') return undefined;
    const { outcome: _outcome, ...rest } = row;
    return { ...rest, state: 'lost' }; // Empty/lost is NOT successful delivery.
  });
}
async function erase(record: BufferRecord, lease: symbol): Promise<void> {
  try { await eraseFiles(record, lease); } catch { throw storageFailure(); }
}

type BufferOptions = {
  ownerScope: string; sessionId: string; retentionMs?: number; maxChunks: number; maxBytes?: number;
  onStorageError?: () => void;
};

/** New capture requires an explicit policy; recovery uses the original journal policy. */
export function openEncryptedChunkBuffer(options: BufferOptions) {
  return openNativeBuffer(options, 'create');
}

/** Replay cannot certify historic STT completeness or grant canonical FINISHED permission. */
export async function reopenEncryptedChunkBuffer(options: Omit<BufferOptions, 'retentionMs'>) {
  const handle = await openNativeBuffer(options, 'existing');
  return { buffer: handle.buffer, close: handle.close };
}

async function openNativeBuffer(options: BufferOptions, mode: 'create' | 'existing') {
  if (mode === 'create') validateBufferPolicy(options.retentionMs, options.maxChunks);
  else if (!Number.isSafeInteger(options.maxChunks) || options.maxChunks <= 0) throw new Error('Geçersiz tampon sınırı.');
  const id = await bufferJournal.identity(options.ownerScope, options.sessionId);
  const lease = bufferJournal.acquire(id);
  if (!lease) throw new Error('Ses tamponu başka bir işlem tarafından kullanılıyor.');
  let record: BufferRecord = { id, ownerHash: options.ownerScope, sessionId: options.sessionId,
    retentionMs: options.retentionMs!, state: 'creating' };
  let db: SQLite.SQLiteDatabase | undefined;
  let leaseHeld = true;
  const releaseLease = () => { if (leaseHeld) { bufferJournal.release(id, lease); leaseHeld = false; } };
  try {
    let key: string;
    if (mode === 'existing') {
      const existing = (await bufferJournal.list()).find(row => row.id === id);
      if (!existing || existing.state !== 'ready' || existing.ownerHash !== options.ownerScope ||
          existing.sessionId !== options.sessionId) throw storageFailure();
      record = existing;
      const originalKey = await SecureStore.getItemAsync(keyName(id));
      if (!fileExists(id) || !originalKey || !/^[a-f0-9]{64}$/.test(originalKey)) {
        await bufferJournal.edit(id, lease, row => ({ ...row!, state: 'lost' }));
        throw storageFailure();
      }
      key = originalKey;
    } else {
      await bufferJournal.edit(id, lease, existing => {
        if (existing) throw new Error('Bu ses oturumu zaten kayıtlı; kurtarma gerekli.');
        return record;
      });
      if (anyFileExists(id) || await SecureStore.getItemAsync(keyName(id)) !== null) {
        await bufferJournal.edit(id, lease, row => ({ ...row!, state: 'lost' }));
        throw new Error('Önceki ses deposu bulundu; yeni dosya ile değiştirilemez.');
      }
      key = Array.from(Crypto.getRandomBytes(32), byte => byte.toString(16).padStart(2, '0')).join('');
      await SecureStore.setItemAsync(keyName(id), key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      if (await SecureStore.getItemAsync(keyName(id)) !== key) throw new Error('Ses anahtarı doğrulanamadı.');
    }
    db = SQLite.openDatabaseSync(fileName(id));
    unlock(db, key);
    const database = db;
    let closed = false;
    let databaseClosed = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const closeDatabase = () => {
      closed = true; clearInterval(timer);
      if (!databaseClosed) {
        try { database.closeSync(); databaseClosed = true; } catch { throw storageFailure(); }
      }
    };
    const assertOpen = () => { if (closed) throw new Error('Ses tamponu kapalı.'); };
    const adapter: SqliteLike = {
      execSync: sql => { assertOpen(); database.execSync(sql); },
      runSync: (sql, params) => { assertOpen(); database.runSync(sql, params); },
      getAllSync: <T>(sql: string, params: SQLite.SQLiteBindValue[] = []) => { assertOpen(); return database.getAllSync<T>(sql, params); },
      getFirstSync: <T>(sql: string, params: SQLite.SQLiteBindValue[] = []) => { assertOpen(); return database.getFirstSync<T>(sql, params); },
    };
    const buffer = new OfflineAudioBuffer({ store: new SqliteChunkStore(adapter, mode), ttlMs: record.retentionMs,
      maxChunks: options.maxChunks, maxBytes: options.maxBytes });
    if (mode === 'existing') {
      buffer.freezeCapture();
      buffer.purgeExpired();
      if (buffer.purged() || buffer.dropped()) {
        await bufferJournal.edit(id, lease, row => ({ ...row!, state: 'lost' }));
        throw storageFailure();
      }
      if (buffer.pending() > options.maxChunks || buffer.bytes() > (options.maxBytes ?? 8 * 1024 * 1024)) throw storageFailure();
    } else await bufferJournal.edit(id, lease, row => {
      if (row?.state !== 'creating') throw new Error('Ses deposu başlangıcı doğrulanamadı.');
      return { ...row, state: 'ready' };
    });
    timer = setInterval(() => {
      if (closed) return;
      try { buffer.purgeExpired(); }
      catch {
        clearInterval(timer);
        try { closeDatabase(); } catch { /* keep the lease for exact-handle retry */ }
        try { options.onStorageError?.(); } catch { /* already stopped storage */ }
      }
    }, Math.min(record.retentionMs, 60000));
    let destroying: Promise<void> | undefined;
    let destroyed = false;
    let terminal: 'drained' | 'lost' | undefined;
    return {
      buffer,
      close: () => { closeDatabase(); releaseLease(); },
      confirmDrained: () => bufferJournal.edit(id, lease, row => {
        if (row?.state === 'drained' && terminal === 'drained') return row;
        if (row?.state !== 'ready') throw new Error('Ses kapanışı doğrulanamadı.');
        // A failed journal write may leave a sealed, genuinely verified buffer.
        // Retry that exact proof; do not invoke a mutator on sealed storage.
        if (terminal !== 'drained') buffer.purgeExpired();
        if (buffer.pending() || buffer.purged() || buffer.dropped()) throw new Error('Ses kaydı eksik; kapanış onayı saklanmadı.');
        buffer.seal(); clearInterval(timer);
        terminal = 'drained';
        return { ...row, state: 'drained' };
      }).catch(() => { throw storageFailure(); }),
      markLost: () => bufferJournal.edit(id, lease, row => {
        if (row?.state === 'lost' && terminal === 'lost') return row;
        if (row?.state !== 'ready' || !(buffer.purged() || buffer.dropped())) throw new Error('Ses kaybı doğrulanamadı.');
        buffer.seal(); clearInterval(timer);
        terminal = 'lost';
        return { ...row, state: 'lost' };
      }).catch(() => { throw storageFailure(); }),
      destroy: () => {
        if (destroyed) return Promise.resolve();
        if (destroying) return destroying;
        destroying = (async () => {
          closeDatabase(); // lease remains held throughout key/file/journal cleanup
          await erase({ ...record, state: terminal ?? record.state }, lease);
          destroyed = true; releaseLease();
        })().finally(() => { destroying = undefined; });
        return destroying;
      },
    };
  } catch {
    const close = () => { db?.closeSync(); releaseLease(); failedOpens.delete(id); };
    try { close(); } catch { failedOpens.set(id, close); }
    throw storageFailure(); // Never propagate native SQL/key diagnostics to the screen.
  }
}

/** Only after canonical incomplete + gateway abandon acknowledgements; never records delivered audio. */
export async function discardAbandonedBuffer(ownerHash: string, sessionId: string): Promise<void> {
  const id = await bufferJournal.identity(ownerHash, sessionId);
  failedOpens.get(id)?.();
  const lease = bufferJournal.acquire(id);
  if (!lease) throw storageFailure();
  try {
    const record = (await bufferJournal.list()).find(row => row.id === id);
    if (!record) return;
    await bufferJournal.edit(id, lease, row => row ? { ...row, state: 'lost', outcome: undefined } : undefined);
    await erase({ ...record, state: 'lost' }, lease);
    await bufferJournal.edit(id, lease, () => undefined);
  } catch { throw storageFailure(); }
  finally { bufferJournal.release(id, lease); }
}

export async function discardOwnerAudioBuffers(ownerHash: string): Promise<boolean> {
  const records = (await bufferJournal.list()).filter(row => row.ownerHash === ownerHash);
  for (const record of records) await discardAbandonedBuffer(ownerHash, record.sessionId);
  return !(await bufferJournal.list()).some(row => row.ownerHash === ownerHash);
}

/** Runs on next app execution/foreground, not while the OS has terminated the process. */
export async function sweepEncryptedChunkBuffers(): Promise<void> {
  let failed = false;
  for (const retry of failedOpens.values()) { try { retry(); } catch { failed = true; } }
  for (const candidate of await bufferJournal.list()) {
    const lease = bufferJournal.acquire(candidate.id);
    if (!lease) continue;
    let db: SQLite.SQLiteDatabase | undefined;
    let released = false;
    const close = () => {
      db?.closeSync(); db = undefined;
      if (!released) { bufferJournal.release(candidate.id, lease); released = true; }
      failedOpens.delete(candidate.id);
    };
    try {
      const record = (await bufferJournal.list()).find(row => row.id === candidate.id);
      if (!record) continue;
      if (record.state === 'lost' && !anyFileExists(record.id) && await SecureStore.getItemAsync(keyName(record.id)) === null) continue;
      if (record.state === 'creating') {
        await bufferJournal.edit(record.id, lease, row => ({ ...row!, state: 'lost' }));
        await erase(record, lease);
        continue;
      }
      if (record.state !== 'ready') { await erase(record, lease); continue; }
      const key = await SecureStore.getItemAsync(keyName(record.id));
      // Never let SQLite silently replace a missing file with an empty success.
      if (!fileExists(record.id) || !key || !/^[a-f0-9]{64}$/.test(key)) {
        await bufferJournal.edit(record.id, lease, row => ({ ...row!, state: 'lost' }));
        await erase(record, lease); continue;
      }
      db = SQLite.openDatabaseSync(fileName(record.id));
      unlock(db, key);
      const database = db;
      const adapter: SqliteLike = {
        execSync: sql => database.execSync(sql), runSync: (sql, params) => { database.runSync(sql, params); },
        getAllSync: <T>(sql: string, params: SQLite.SQLiteBindValue[] = []) => database.getAllSync<T>(sql, params),
        getFirstSync: <T>(sql: string, params: SQLite.SQLiteBindValue[] = []) => database.getFirstSync<T>(sql, params),
      };
      const buffer = new OfflineAudioBuffer({ store: new SqliteChunkStore(adapter, 'existing'), ttlMs: record.retentionMs });
      buffer.purgeExpired();
      const lost = buffer.purged() > 0 || buffer.dropped() > 0;
      db.closeSync(); db = undefined;
      if (lost) {
        await bufferJournal.edit(record.id, lease, row => ({ ...row!, state: 'lost' }));
        await erase(record, lease);
      } // An empty but undrained ready buffer remains recoverable, never auto-finished.
    } catch { failed = true; }
    finally {
      try { close(); } catch { failedOpens.set(candidate.id, close); failed = true; }
    }
  }
  if (failed) throw new Error('Bazı ses depolarının temizliği doğrulanamadı; yeniden denenecek.');
}
