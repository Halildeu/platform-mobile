import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Directory, File } from 'expo-file-system';
import { DiagnosticHistory, decodeEntry, type Entry, type HistoryStore } from './history';

let opening: Promise<unknown> = Promise.resolve();

/** Distinct encrypted database per authenticated issuer/user/tenant hash. */
export function openDiagnosticHistory(ownerHash: string): Promise<DiagnosticHistory> {
  const result = opening.then(() => openHistory(ownerHash));
  opening = result.catch(() => {});
  return result;
}
async function openHistory(ownerHash: string): Promise<DiagnosticHistory> {
  if (!/^[a-f0-9]{64}$/.test(ownerHash)) throw new Error('Tanılama kullanıcısı doğrulanamadı.');
  const name = `diagnostics-${ownerHash}.db`;
  const keyName = `diagnostics-key-${ownerHash}`;
  const directory = new Directory(SQLite.defaultDatabaseDirectory);
  if (!new File(directory, name).exists && directory.exists &&
    directory.list().filter(file => /^diagnostics-[a-f0-9]{64}\.db$/.test(file.name)).length >= 8) {
    throw new Error('Tanılama hesap kapasitesine ulaşıldı.');
  }
  let key = await SecureStore.getItemAsync(keyName);
  if (!key) {
    if (['', '-wal', '-shm', '-journal'].some(suffix => new File(SQLite.defaultDatabaseDirectory, name + suffix).exists)) {
      throw new Error('Önceki tanılama deposunun anahtarı bulunamadı.');
    }
    key = Array.from(Crypto.getRandomBytes(32), b => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(keyName, key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    if (await SecureStore.getItemAsync(keyName) !== key) throw new Error('Tanılama anahtarı saklanamadı.');
  }
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Tanılama anahtarı geçersiz.');
  const db = SQLite.openDatabaseSync(name, { useNewConnection: true });
  try {
    if (!db.getFirstSync<{ cipher_version: string }>('PRAGMA cipher_version')?.cipher_version) throw new Error('Şifreli tanılama desteklenmiyor.');
    db.execSync(`PRAGMA key = "x'${key}'"`);
    db.execSync('PRAGMA secure_delete = ON; PRAGMA journal_mode = DELETE;');
    const store = new SqlDiagnosticStore(db);
    return new DiagnosticHistory(store);
  } catch (error) { db.closeSync(); throw error; }
}

type Database = Pick<SQLite.SQLiteDatabase, 'execSync' | 'runSync' | 'getAllSync' | 'getFirstSync' | 'withTransactionSync' | 'closeSync'>;
export class SqlDiagnosticStore implements HistoryStore {
  constructor(private readonly db: Database) {
    db.execSync(`CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, meeting TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_meeting ON events(meeting, id);
      CREATE TABLE IF NOT EXISTS counters (id INTEGER PRIMARY KEY CHECK(id=1), removed INTEGER NOT NULL);
      INSERT OR IGNORE INTO counters VALUES (1,0);`);
  }
  private prune(cutoff: number, limit?: number) {
    let removed = this.db.runSync('DELETE FROM events WHERE at < ?', cutoff).changes;
    if (limit !== undefined) removed += this.db.runSync('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT ?)', limit).changes;
    if (removed) this.db.runSync('UPDATE counters SET removed=removed+? WHERE id=1', removed);
  }
  append(entry: Entry, cutoff: number, limit: number) {
    this.db.withTransactionSync(() => {
      this.db.runSync('INSERT INTO events(at,meeting,payload) VALUES (?,?,?)', entry.at, entry.meeting, JSON.stringify(entry));
      this.prune(cutoff, limit);
    });
  }
  read(meeting: string, cutoff: number) {
    this.db.withTransactionSync(() => this.prune(cutoff));
    return { entries: this.db.getAllSync<{ payload: string }>('SELECT payload FROM events WHERE meeting=? ORDER BY id', meeting)
      .map(row => decodeEntry(row.payload, meeting)),
    removed: this.db.getFirstSync<{ removed: number }>('SELECT removed FROM counters WHERE id=1')?.removed ?? 0 };
  }
  clear(meeting: string) { this.db.runSync('DELETE FROM events WHERE meeting=?', meeting); }
  close() { this.db.closeSync(); }
}
