import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { OfflineAudioBuffer } from './offlineBuffer';
import { SqliteChunkStore, type SqliteLike } from './sqliteChunkStore';

export function validateBufferPolicy(retentionMs: number | undefined, maxChunks: number): void {
  if (!Number.isSafeInteger(retentionMs) || (retentionMs ?? 0) <= 0) {
    throw new Error('Ses saklama süresi yapılandırılmadı; kalıcı tampon açılamaz.');
  }
  if (!Number.isSafeInteger(maxChunks) || maxChunks <= 0) throw new Error('Geçersiz tampon sınırı.');
}

/** Opening durable storage requires an explicit owner retention policy and a SQLCipher build. */
export async function openEncryptedChunkBuffer(options: {
  ownerScope: string; sessionId: string; retentionMs?: number; maxChunks: number; maxBytes?: number;
  onStorageError?: () => void;
}) {
  validateBufferPolicy(options.retentionMs, options.maxChunks);
  if (!options.ownerScope || !/^[A-Za-z0-9._:-]{1,128}$/.test(options.sessionId)) throw new Error('Geçersiz ses oturumu.');
  const name = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify([options.ownerScope, options.sessionId]));
  const keyName = `audio-buffer-${name}`;
  let key = await SecureStore.getItemAsync(keyName);
  if (!key) {
    key = Array.from(Crypto.getRandomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(keyName, key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  }
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Ses tamponu anahtarı geçersiz.');
  const db = SQLite.openDatabaseSync(`audio-${name}.db`);
  try {
    const cipher = db.getFirstSync<{ cipher_version: string }>('PRAGMA cipher_version');
    if (!cipher?.cipher_version) throw new Error('Şifreli depolama bu uygulama sürümünde yok.');
    db.execSync(`PRAGMA key = "x'${key}'"`);
    db.execSync('PRAGMA secure_delete = ON;');
    let closed = false;
    let databaseClosed = false;
    const closeDatabase = () => {
      if (databaseClosed) return;
      db.closeSync();
      databaseClosed = true;
    };
    const assertOpen = () => { if (closed) throw new Error('Ses tamponu kapalı.'); };
    const adapter: SqliteLike = {
      execSync: (sql) => { assertOpen(); db.execSync(sql); }, runSync: (sql, params) => { assertOpen(); db.runSync(sql, params); },
      getAllSync: <T>(sql: string, params: SQLite.SQLiteBindValue[] = []) => { assertOpen(); return db.getAllSync<T>(sql, params); },
      getFirstSync: <T>(sql: string, params: SQLite.SQLiteBindValue[] = []) => { assertOpen(); return db.getFirstSync<T>(sql, params); },
    };
    const buffer = new OfflineAudioBuffer({ store: new SqliteChunkStore(adapter),
      ttlMs: options.retentionMs, maxChunks: options.maxChunks, maxBytes: options.maxBytes });
    buffer.purgeExpired();
    const timer = setInterval(() => {
      if (closed) return;
      try { buffer.purgeExpired(); }
      catch {
        clearInterval(timer);
        closed = true;
        try { closeDatabase(); } catch { /* close/destroy can retry; further access remains blocked. */ }
        options.onStorageError?.();
      }
    }, Math.min(options.retentionMs!, 60000));
    const close = () => { closed = true; clearInterval(timer); closeDatabase(); };
    let destroyed = false;
    let destroying: Promise<void> | undefined;
    return { buffer, close, destroy: () => {
      if (destroyed) return Promise.resolve();
      if (destroying) return destroying;
      // Serialize concurrent cleanup and retry failed close/key/file removal.
      destroying = (async () => {
        close();
        await SecureStore.deleteItemAsync(keyName);
        SQLite.deleteDatabaseSync(`audio-${name}.db`);
        destroyed = true;
      })().finally(() => { destroying = undefined; });
      return destroying;
    } };
  } catch (error) { db.closeSync(); throw error; }
}
