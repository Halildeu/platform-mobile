import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Directory, File } from 'expo-file-system';
import { DiagnosticHistory, decodeEntry, HISTORY_DAYS, type Entry, type HistoryStore } from './history';
import { decodeDetail, DETAIL_STORAGE_BYTES, type DetailEntry } from './detailedCapture';
import { databaseFileUri } from './databaseFileUri';
import { DiagnosticOpenError, type DiagnosticFailureCode } from './openFailure';

let opening: Promise<unknown> = Promise.resolve();

/** Distinct encrypted database per authenticated issuer/user/tenant hash. */
export function openDiagnosticHistory(ownerHash: string): Promise<DiagnosticHistory> {
  const result = opening.then(() => openHistory(ownerHash));
  opening = result.catch(() => {});
  return result;
}
async function openHistory(ownerHash: string): Promise<DiagnosticHistory> {
  let stage: DiagnosticFailureCode = 'HISTORY_IDENTITY';
  let db: SQLite.SQLiteDatabase | undefined;
  try {
    if (!/^[a-f0-9]{64}$/.test(ownerHash)) throw new DiagnosticOpenError(stage);
    const name = `diagnostics-${ownerHash}.db`;
    const keyName = `diagnostics-key-${ownerHash}`;
    stage = 'HISTORY_DIRECTORY';
    const directory = new Directory(databaseFileUri(SQLite.defaultDatabaseDirectory));
    if (!new File(directory, name).exists && directory.exists &&
      directory.list().filter(file => /^diagnostics-[a-f0-9]{64}\.db$/.test(file.name)).length >= 8) {
      throw new DiagnosticOpenError('HISTORY_CAPACITY');
    }
    stage = 'HISTORY_KEY_READ';
    let key = await SecureStore.getItemAsync(keyName);
    if (!key) {
      stage = 'HISTORY_DIRECTORY';
      if (['', '-wal', '-shm', '-journal'].some(suffix => new File(directory, name + suffix).exists)) {
        throw new DiagnosticOpenError('HISTORY_KEY_MISSING');
      }
      stage = 'HISTORY_KEY_WRITE';
      key = Array.from(Crypto.getRandomBytes(32), b => b.toString(16).padStart(2, '0')).join('');
      await SecureStore.setItemAsync(keyName, key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      if (await SecureStore.getItemAsync(keyName) !== key) throw new DiagnosticOpenError(stage);
    }
    if (!/^[a-f0-9]{64}$/.test(key)) throw new DiagnosticOpenError('HISTORY_KEY_INVALID');
    stage = 'HISTORY_DATABASE_OPEN';
    db = SQLite.openDatabaseSync(name, { useNewConnection: true });
    stage = 'HISTORY_CIPHER';
    if (!db.getFirstSync<{ cipher_version: string }>('PRAGMA cipher_version')?.cipher_version) throw new DiagnosticOpenError(stage);
    stage = 'HISTORY_UNLOCK';
    db.execSync(`PRAGMA key = "x'${key}'"`);
    db.execSync('PRAGMA secure_delete = ON; PRAGMA journal_mode = DELETE;');
    stage = 'HISTORY_SCHEMA';
    const store = new SqlDiagnosticStore(db);
    return new DiagnosticHistory(store);
  } catch (error) {
    try { db?.closeSync(); } catch { /* Preserve the original safe opening stage. */ }
    throw error instanceof DiagnosticOpenError ? error : new DiagnosticOpenError(stage);
  }
}

type Database = Pick<SQLite.SQLiteDatabase, 'execSync' | 'runSync' | 'getAllSync' | 'getFirstSync' | 'withTransactionSync' | 'closeSync'>;
export class SqlDiagnosticStore implements HistoryStore {
  constructor(private readonly db: Database) {
    db.execSync(`CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, meeting TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_meeting ON events(meeting, id);
      CREATE TABLE IF NOT EXISTS counters (id INTEGER PRIMARY KEY CHECK(id=1), removed INTEGER NOT NULL);
      INSERT OR IGNORE INTO counters VALUES (1,0);
      CREATE TABLE IF NOT EXISTS detailed_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, expires_at INTEGER NOT NULL, meeting TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS detailed_meeting ON detailed_events(meeting,id);
      CREATE TABLE IF NOT EXISTS detailed_counters (id INTEGER PRIMARY KEY CHECK(id=1), removed INTEGER NOT NULL);
      INSERT OR IGNORE INTO detailed_counters VALUES (1,0);`);
  }
  private prune(cutoff: number, limit?: number) {
    this.pruneDetails(cutoff + HISTORY_DAYS * 86400000);
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
  private pruneDetails(cutoff: number, limit?: number) {
    let removed = this.db.runSync('DELETE FROM detailed_events WHERE expires_at <= ?', cutoff).changes;
    if (limit !== undefined) removed += this.db.runSync('DELETE FROM detailed_events WHERE id NOT IN (SELECT id FROM detailed_events ORDER BY id DESC LIMIT ?)', limit).changes;
    // Bound UTF-8 payload bytes before any content is loaded into JavaScript memory.
    removed += this.db.runSync(`DELETE FROM detailed_events WHERE id IN (
      SELECT id FROM (SELECT id, SUM(length(CAST(payload AS BLOB))) OVER (ORDER BY id DESC) AS bytes FROM detailed_events)
      WHERE bytes > ?)`, DETAIL_STORAGE_BYTES).changes;
    if (removed) this.db.runSync('UPDATE detailed_counters SET removed=removed+? WHERE id=1', removed);
  }
  appendDetail(entry: DetailEntry, cutoff: number, limit: number) {
    this.db.withTransactionSync(() => {
      this.db.runSync('INSERT INTO detailed_events(at,expires_at,meeting,payload) VALUES (?,?,?,?)', entry.at, entry.expiresAt, entry.meeting, JSON.stringify(entry));
      this.pruneDetails(cutoff, limit);
    });
  }
  readDetails(meeting: string, cutoff: number) {
    this.db.withTransactionSync(() => this.pruneDetails(cutoff));
    return { entries: this.db.getAllSync<{ payload: string }>('SELECT payload FROM detailed_events WHERE meeting=? ORDER BY id', meeting)
      .map(row => decodeDetail(row.payload, meeting)), removed: this.db.getFirstSync<{ removed: number }>('SELECT removed FROM detailed_counters WHERE id=1')?.removed ?? 0 };
  }
  clearDetails(meeting: string) { this.db.runSync('DELETE FROM detailed_events WHERE meeting=?', meeting); }
  close() { this.db.closeSync(); }
}
