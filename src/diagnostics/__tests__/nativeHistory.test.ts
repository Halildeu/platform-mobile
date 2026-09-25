import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { openDiagnosticHistory, SqlDiagnosticStore } from '../nativeHistory';
import { DiagnosticHistory } from '../history';

let mockDirectory: string;
jest.mock('expo-sqlite', () => ({ get defaultDatabaseDirectory() { return mockDirectory; }, openDatabaseSync: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1 }));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(32).fill(17) }));
jest.mock('expo-file-system', () => ({
  Directory: class { path: string; constructor(path: string) { this.path = path; }
    get exists() { return jest.requireActual('node:fs').existsSync(this.path); }
    list() { return jest.requireActual('node:fs').readdirSync(this.path).map((name: string) => ({ name })); } },
  File: class { path: string; constructor(directory: string | { path: string }, name: string) { this.path = jest.requireActual('node:path').join(typeof directory === 'string' ? directory : directory.path, name); }
    get exists() { return jest.requireActual('node:fs').existsSync(this.path); } },
}));
let keys: Map<string, string>; let databases: DatabaseSync[]; let cipher: boolean;
const owner = 'a'.repeat(64), other = 'b'.repeat(64);
const meeting = '604593c5-9c2d-4c86-bc1d-2aec2270cf99';
function adapter(db: DatabaseSync) {
  return {
    // Actual SQLite durability/transactions; cipher availability is simulated, not encryption acceptance.
    execSync: (sql: string) => db.exec(sql),
    runSync: (sql: string, ...params: (string | number)[]) => db.prepare(sql).run(...params),
    getFirstSync: (sql: string, ...params: (string | number)[]) => sql === 'PRAGMA cipher_version' ? (cipher ? { cipher_version: 'test-capability' } : null) : db.prepare(sql).get(...params),
    getAllSync: (sql: string, ...params: (string | number)[]) => db.prepare(sql).all(...params),
    withTransactionSync: (work: () => void) => { db.exec('BEGIN'); try { work(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
    closeSync: () => db.close(),
  } as unknown as SQLite.SQLiteDatabase;
}
beforeEach(() => {
  jest.resetAllMocks(); keys = new Map(); databases = []; cipher = true;
  mockDirectory = mkdtempSync(join(tmpdir(), 'mobile-diagnostics-'));
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async k => keys.get(k) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (k, v) => { keys.set(k, v); });
  jest.mocked(SQLite.openDatabaseSync).mockImplementation(name => { const db = new DatabaseSync(join(mockDirectory, name)); databases.push(db); return adapter(db); });
});
afterEach(() => {
  for (const db of databases) { try { db.close(); } catch { /* already closed */ } }
  const target = resolve(mockDirectory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('mobile-diagnostics-')) throw new Error('Unsafe fixture');
  rmSync(target, { recursive: true, force: true });
});
test('survives close/reopen, keeps separate account and adds subsequent events', async () => {
  const first = await openDiagnosticHistory(owner); first.record(meeting, 'run_started'); first.close();
  const second = await openDiagnosticHistory(owner); second.record(meeting, 'saved_received');
  expect(second.report(meeting)).toContain('Kayıt denemesi başladı');
  expect(second.report(meeting)).toContain('Kalıcı sonuç ve toplantı eşleşmesi');
  const foreign = await openDiagnosticHistory(other); expect(foreign.report(meeting)).not.toContain('Kayıt denemesi başladı');
  foreign.clear(meeting); expect(second.report(meeting)).toContain('Kayıt denemesi başladı');
  expect(readdirSync(mockDirectory)).toHaveLength(2);
});
test('serializes key creation and gives simultaneous callers separate native connections', async () => {
  const [a, b] = await Promise.all([openDiagnosticHistory(owner), openDiagnosticHistory(owner)]);
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  expect(SQLite.openDatabaseSync).toHaveBeenCalledWith(`diagnostics-${owner}.db`, { useNewConnection: true });
  a.record(meeting, 'run_started'); a.close(); expect(b.report(meeting)).toContain('Kayıt denemesi başladı');
});
test.each(['missing-key', 'missing-cipher', 'key-write'] as const)('fails closed on %s without replacing existing records', async mode => {
  if (mode === 'missing-key') writeFileSync(join(mockDirectory, `diagnostics-${owner}.db`), 'old-data');
  if (mode === 'missing-cipher') cipher = false;
  if (mode === 'key-write') jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
  await expect(openDiagnosticHistory(owner)).rejects.toThrow();
  if (mode !== 'missing-cipher') expect(SQLite.openDatabaseSync).not.toHaveBeenCalled();
});
test('purges expired records on read and explicitly reports capacity truncation', () => {
  const db = new DatabaseSync(join(mockDirectory, 'fixture.db')); databases.push(db);
  const store = new SqlDiagnosticStore(adapter(db));
  for (let i = 0; i < 4; i++) store.append({ at: i + 1, meeting, kind: 'opened', data: {} }, 0, 3);
  expect(store.read(meeting, 0)).toMatchObject({ removed: 1, entries: [{ at: 2 }, { at: 3 }, { at: 4 }] });
  expect(store.read(meeting, 4)).toMatchObject({ removed: 3, entries: [{ at: 4 }] });
  expect(new DiagnosticHistory(store, () => 31 * 86400000).report(meeting)).toContain('saklanmış teknik olay bulunmuyor');
});
test('account cap prevents unbounded files and rejects invalid path identities', async () => {
  for (let i = 0; i < 8; i++) writeFileSync(join(mockDirectory, `diagnostics-${String(i).repeat(64)}.db`), 'old');
  await expect(openDiagnosticHistory(owner)).rejects.toThrow('kapasitesine');
  await expect(openDiagnosticHistory('../bad')).rejects.toThrow();
  expect(existsSync(join(mockDirectory, `diagnostics-${owner}.db`))).toBe(false);
});
