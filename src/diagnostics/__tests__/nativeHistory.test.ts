import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { openDiagnosticHistory, SqlDiagnosticStore } from '../nativeHistory';
import { DiagnosticHistory } from '../history';
import { DETAIL_STORAGE_BYTES, DETAIL_REPORT_CHARACTERS } from '../detailedCapture';
import { databaseFileUri } from '../databaseFileUri';

let mockDirectory: string;
let mockNativeDirectory: string;
jest.mock('expo-sqlite', () => ({ get defaultDatabaseDirectory() { return mockNativeDirectory; }, openDatabaseSync: jest.fn() }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1 }));
jest.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(32).fill(17) }));
function mockFsPath(uri: string) {
  // Match the native File(URI) boundary instead of accepting arbitrary Node paths.
  if (!uri.startsWith('file:///')) throw new Error('URI is not absolute');
  const decoded = decodeURIComponent(uri.slice('file://'.length));
  if (decoded !== mockNativeDirectory && !decoded.startsWith(mockNativeDirectory + '/')) throw new Error('Wrong native directory');
  return jest.requireActual('node:path').join(mockDirectory, decoded.slice(mockNativeDirectory.length));
}
jest.mock('expo-file-system', () => ({
  Directory: class { uri: string; constructor(uri: string) { this.uri = uri; }
    get exists() { return jest.requireActual('node:fs').existsSync(mockFsPath(this.uri)); }
    list() { return jest.requireActual('node:fs').readdirSync(mockFsPath(this.uri)).map((name: string) => ({ name })); } },
  File: class { uri: string; constructor(directory: string | { uri: string }, name: string) { this.uri = `${typeof directory === 'string' ? directory : directory.uri}/${name}`; }
    get exists() { return jest.requireActual('node:fs').existsSync(mockFsPath(this.uri)); } },
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
  mockNativeDirectory = '/data/user/0/com.workcube.meeting/files/SQLite';
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
  const codes = { 'missing-key': 'HISTORY_KEY_MISSING', 'missing-cipher': 'HISTORY_CIPHER', 'key-write': 'HISTORY_KEY_WRITE' };
  await expect(openDiagnosticHistory(owner)).rejects.toMatchObject({ code: codes[mode] });
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
  await expect(openDiagnosticHistory(owner)).rejects.toMatchObject({ code: 'HISTORY_CAPACITY' });
  await expect(openDiagnosticHistory('../bad')).rejects.toThrow();
  expect(existsSync(join(mockDirectory, `diagnostics-${owner}.db`))).toBe(false);
});

test('uses file URIs with native iOS paths while leaving the SQLite location unchanged', async () => {
  mockNativeDirectory = '/var/mobile/Containers/Data/Application/TEST/Documents/SQLite';
  const first = await openDiagnosticHistory(owner); first.record(meeting, 'opened'); first.close();
  expect((await openDiagnosticHistory(owner)).report(meeting)).toContain('Toplantı tanılaması açıldı');
  expect(SQLite.openDatabaseSync).toHaveBeenCalledWith(`diagnostics-${owner}.db`, { useNewConnection: true });
});

test('preserves native path characters and existing file URIs; rejects relative and non-file locations', () => {
  expect(databaseFileUri('/data/user/0/app/files/SQLite')).toBe('file:///data/user/0/app/files/SQLite');
  expect(databaseFileUri('/var/mobile/Örnek % #?/SQLite')).toBe('file:///var/mobile/%C3%96rnek%20%25%20%23%3F/SQLite');
  expect(databaseFileUri('file:///var/mobile/Already%20Encoded/SQLite')).toBe('file:///var/mobile/Already%20Encoded/SQLite');
  for (const path of ['relative', 'https://example.test', '//remote/share', 'content://authority', '']) expect(() => databaseFileUri(path)).toThrow();
});

test('returns safe stages instead of native exception messages or keys', async () => {
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('SECRET_NATIVE_PATH_TOKEN'));
  await expect(openDiagnosticHistory(owner)).rejects.toMatchObject({ code: 'HISTORY_KEY_READ', message: 'Şifreleme anahtarı cihazdan okunamadı.' });
  mockNativeDirectory = 'relative';
  await expect(openDiagnosticHistory(owner)).rejects.toMatchObject({ code: 'HISTORY_DIRECTORY' });
});

test('keeps opt-in content separate from ordinary reports, survives reopen, expires within 24h and isolates accounts', async () => {
  const first = await openDiagnosticHistory(owner);
  expect(first.beginDetailed(meeting, meeting, 'android')).toBeNull();
  const detailed = first.beginDetailed(meeting, meeting, 'android', 3600000)!;
  detailed.text({ seq: 1, text: 'PRIVATE_NAME. PRIVATE_TASK', final: true });
  detailed.stop();
  expect(first.report(meeting)).not.toContain('PRIVATE');
  expect(first.detailedReport(meeting)).toContain('PRIVATE_NAME. PRIVATE_TASK');
  const unfinished = first.beginDetailed(meeting, meeting, 'android', 3600000)!;
  first.close(); unfinished.text({ seq: 2, text: 'LATE_PRIVATE', final: true });
  const reopened = await openDiagnosticHistory(owner);
  expect(reopened.detailedReport(meeting)).toContain('PRIVATE_NAME');
  expect(reopened.detailedReport(meeting)).not.toContain('LATE_PRIVATE');
  const foreign = await openDiagnosticHistory(other);
  expect(foreign.detailedReport(meeting)).not.toContain('PRIVATE_NAME');
  const db = databases[1];
  db.prepare('UPDATE detailed_events SET expires_at=?').run(Date.now() - 1);
  expect(reopened.detailedReport(meeting)).not.toContain('PRIVATE_NAME');
  expect(db.prepare('SELECT COUNT(*) AS n FROM detailed_events').get()).toEqual({ n: 0 });
});

test('detailed quota and clearing do not delete ordinary diagnostics', () => {
  const db = new DatabaseSync(join(mockDirectory, 'fixture.db')); databases.push(db);
  const store = new SqlDiagnosticStore(adapter(db));
  store.append({ at: Date.now(), meeting, kind: 'opened', data: {} }, 0, 3);
  for (let i = 0; i < 4; i++) store.appendDetail({ at: i + 1, expiresAt: 100, meeting, runId: meeting, payload: { kind: 'begin' } }, 0, 3);
  expect(store.readDetails(meeting, 0)).toMatchObject({ removed: 1, entries: [{ at: 2 }, { at: 3 }, { at: 4 }] });
  store.clearDetails(meeting);
  expect(store.read(meeting, 0).entries).toHaveLength(1);
  expect(store.readDetails(meeting, 0).entries).toHaveLength(0);
});

test('bounds UTF-8 account content before loading and limits export with explicit omission counts', () => {
  const db = new DatabaseSync(join(mockDirectory, 'fixture.db')); databases.push(db);
  const store = new SqlDiagnosticStore(adapter(db));
  for (let i = 0; i < 150; i++) store.appendDetail({ at: i + 1, expiresAt: 3600000, meeting, runId: meeting,
    payload: { kind: 'gateway_text', seq: i, text: 'Ş'.repeat(4000), confirmed: 'Ş'.repeat(4000), tentative: 'Ş'.repeat(4000) } }, 0, 5000);
  const bytes = db.prepare('SELECT SUM(length(CAST(payload AS BLOB))) AS bytes FROM detailed_events').get()!.bytes as number;
  expect(bytes).toBeLessThanOrEqual(DETAIL_STORAGE_BYTES);
  const saved = store.readDetails(meeting, 0);
  expect(saved.removed).toBeGreaterThan(0);
  expect(saved.entries.at(-1)!.payload.seq).toBe(149);
  const report = new DiagnosticHistory(store, () => 1000).detailedReport(meeting);
  expect(report.length).toBeLessThanOrEqual(DETAIL_REPORT_CHARACTERS);
  expect(report).toMatch(/dışa aktarıma alınmayan eski olay: [1-9]/);
  expect(report).toContain('"seq":149');
});
