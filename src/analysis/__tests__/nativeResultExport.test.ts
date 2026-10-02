import { createNativeResultExportIO, isOwnedPdf, resultExporter } from '../nativeResultExport';
import * as fs from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { ExportCancelled, ResultExportManager } from '../resultExportManager';
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', getInfoAsync: jest.fn(), readDirectoryAsync: jest.fn(), deleteAsync: jest.fn() }));
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
const pdf = '00000000-1111-2222-3333-444444444444.pdf';
beforeEach(() => jest.clearAllMocks());
test('rechecks ownership after lazy clipboard module loading before native write', async () => {
  const setStringAsync = jest.fn().mockResolvedValue(true);
  let loaded!: (value: { setStringAsync: typeof setStringAsync }) => void;
  const io = createNativeResultExportIO({ clipboard: () => new Promise(resolve => { loaded = resolve; }),
    sharing: jest.fn() });
  const manager = new ResultExportManager(io);
  let allowed = true;
  const work = manager.copy('private', () => allowed);
  allowed = false;
  loaded({ setStringAsync });
  await expect(work).rejects.toBeInstanceOf(ExportCancelled);
  expect(setStringAsync).not.toHaveBeenCalled();
});

test.each(['account change', 'logout purge'])('cancels delayed PDF native loading after %s and deletes unshared PDF', async reason => {
  const shareAsync = jest.fn().mockResolvedValue(undefined);
  const module = { shareAsync, isAvailableAsync: jest.fn().mockResolvedValue(true) };
  let loaded!: (value: typeof module) => void;
  const sharing = jest.fn().mockResolvedValueOnce(module).mockImplementationOnce(
    () => new Promise(resolve => { loaded = resolve; }),
  );
  const uri = 'file:///cache/meeting-exports/' + pdf;
  const io = createNativeResultExportIO({ clipboard: jest.fn(), sharing });
  io.files = jest.fn().mockResolvedValue([]);
  io.generate = jest.fn().mockResolvedValue(uri);
  io.inspect = jest.fn().mockResolvedValue({ uri, size: 100, modified: Date.now() });
  io.retain = jest.fn().mockResolvedValue(uri);
  const manager = new ResultExportManager(io);
  let allowed = true;
  const work = manager.pdf('html', () => allowed);
  while (!loaded) await Promise.resolve();
  if (reason === 'account change') allowed = false;
  else await manager.cleanup(true);
  loaded(module);
  await expect(work).rejects.toBeInstanceOf(ExportCancelled);
  expect(shareAsync).not.toHaveBeenCalled();
  expect(fs.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true });
});
test('accepts only exact owned UUID PDF paths; rejects traversal/encoded/sibling paths', () => {
  expect(isOwnedPdf('file:///cache/meeting-exports/' + pdf)).toBe(true);
  for (const path of ['file:///cache/Print/../' + pdf, 'file:///cache/Print/%2e%2e/' + pdf,
    'file:///cache/Print/' + pdf + '/child', 'file:///else/' + pdf, 'https://example/' + pdf])
    expect(isOwnedPdf(path)).toBe(false);
});
test('cleanup preserves unrelated cache files', async () => {
  jest.mocked(fs.getInfoAsync).mockImplementation(async uri => ({ exists: true, isDirectory: false, uri, size: 100, modificationTime: 0 }));
  jest.mocked(fs.readDirectoryAsync).mockResolvedValue(['user.pdf', '../other', pdf]);
  await resultExporter.cleanup(true);
  expect(fs.deleteAsync).toHaveBeenCalledTimes(2);
  for (const [uri] of jest.mocked(fs.deleteAsync).mock.calls) expect(uri).toMatch(new RegExp(pdf.replaceAll('.', '\\.')));
});
test('unsupported platforms do not attempt PDF generation', async () => {
  const os = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  await expect(resultExporter.pdf('html', () => true)).rejects.toThrow();
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
});
