import * as fs from 'expo-file-system/legacy';
import { ReportFileExporter, ReportCancelled } from '../reportFile';
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', EncodingType: { UTF8: 'utf8' },
  getInfoAsync: jest.fn(), readDirectoryAsync: jest.fn(), deleteAsync: jest.fn(), makeDirectoryAsync: jest.fn(), writeAsStringAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
const filename = '11111111-1111-4111-8111-111111111111.txt';
const uri = 'file:///cache/technical-reports/' + filename;
const sharing = { isAvailableAsync: jest.fn(), shareAsync: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fs.getInfoAsync).mockResolvedValue({ exists: true, isDirectory: false, uri, size: 100, modificationTime: 1000 });
  jest.mocked(fs.readDirectoryAsync).mockResolvedValue([]);
  sharing.isAvailableAsync.mockResolvedValue(true); sharing.shareAsync.mockResolvedValue(undefined);
});
const exporter = () => new ReportFileExporter(async () => sharing as unknown as typeof import('expo-sharing'), () => 1000000);
test('shares full UTF8 report without truncation and retains after native handoff', async () => {
  const text = 'Türkçe teknik olay\n'.repeat(5000);
  await exporter().share(text, () => true);
  expect(fs.writeAsStringAsync).toHaveBeenCalledWith(uri, text, { encoding: 'utf8' });
  expect(sharing.shareAsync).toHaveBeenCalledWith(uri, expect.objectContaining({ mimeType: 'text/plain' }));
  expect(fs.deleteAsync).not.toHaveBeenCalled();
});
test('account changes during write cancel before native sharing and remove unshared file', async () => {
  let current = true;
  jest.mocked(fs.writeAsStringAsync).mockImplementationOnce(async () => { current = false; });
  await expect(exporter().share('report', () => current)).rejects.toBeInstanceOf(ReportCancelled);
  expect(sharing.shareAsync).not.toHaveBeenCalled();
  expect(fs.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
});
test('logout invalidates an in-flight share before lazy native loading', async () => {
  let resolve!: (value: typeof import('expo-sharing')) => void;
  const e = new ReportFileExporter(() => new Promise(r => { resolve = r; }), () => 1000000);
  const job = e.share('report', () => true);
  await e.cleanup(true);
  resolve(sharing as unknown as typeof import('expo-sharing'));
  await expect(job).rejects.toBeInstanceOf(ReportCancelled);
  expect(sharing.shareAsync).not.toHaveBeenCalled();
});
test('cleanup removes only owned names and enforces TTL', async () => {
  jest.mocked(fs.readDirectoryAsync).mockResolvedValue([filename, '../private.txt', 'user.txt']);
  const e = new ReportFileExporter(async () => sharing as unknown as typeof import('expo-sharing'), () => 1600000);
  await e.cleanup();
  expect(fs.deleteAsync).toHaveBeenCalledTimes(1);
  expect(fs.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
});
test('oversized report never writes or invokes native share', async () => {
  await expect(exporter().share('x'.repeat(16 * 1024 * 1024 + 1), () => true)).rejects.toThrow();
  expect(fs.writeAsStringAsync).not.toHaveBeenCalled(); expect(sharing.shareAsync).not.toHaveBeenCalled();
});
