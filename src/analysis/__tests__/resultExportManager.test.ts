import { ExportCancelled, ResultExportManager, MAX_PDF_BYTES, PDF_CACHE_MS, type ExportIO } from '../resultExportManager';

function setup() {
  const now = 1_000_000;
  const io: jest.Mocked<ExportIO> = {
    available: jest.fn().mockResolvedValue(true), files: jest.fn().mockResolvedValue([]),
    remove: jest.fn().mockResolvedValue(undefined), generate: jest.fn().mockResolvedValue('raw'),
    inspect: jest.fn().mockResolvedValue({ uri: 'raw', size: 100, modified: now }),
    retain: jest.fn().mockResolvedValue('kept'), share: jest.fn(async (_uri, beforeNative) => { beforeNative(); }),
    copy: jest.fn(async (_text, beforeNative) => { beforeNative(); return true; }),
  };
  return { io, manager: new ResultExportManager(io, () => now), now };
}
test('keeps shared PDF while the receiving app may still read it; sweeps only after threshold', async () => {
  const { manager, io, now } = setup();
  await manager.pdf('html', () => true);
  expect(io.share).toHaveBeenCalledWith('kept', expect.any(Function));
  expect(io.remove).not.toHaveBeenCalled();
  io.files.mockResolvedValue([{ uri: 'kept', size: 100, modified: now }]);
  await manager.cleanup(); expect(io.remove).not.toHaveBeenCalled();
  io.files.mockResolvedValue([{ uri: 'kept', size: 100, modified: now - PDF_CACHE_MS }]);
  await manager.cleanup(); expect(io.remove).toHaveBeenCalledWith('kept');
});
test('account/meeting change during rendering prevents sharing and removes its generated file', async () => {
  const { manager, io } = setup();
  let current = true;
  io.generate.mockImplementation(async () => { current = false; return 'raw'; });
  await expect(manager.pdf('html', () => current)).rejects.toBeInstanceOf(ExportCancelled);
  expect(io.share).not.toHaveBeenCalled(); expect(io.remove).toHaveBeenCalledWith('raw');
});
test('logout during a cache scan is not lost and invalidates the pending export', async () => {
  const { manager, io, now } = setup();
  let finish!: () => void;
  io.files.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve([]); }));
  io.files.mockResolvedValue([{ uri: 'old', size: 100, modified: now }]);
  const work = manager.pdf('html', () => true);
  while (!finish) await Promise.resolve();
  await manager.cleanup(true); finish();
  await expect(work).rejects.toBeInstanceOf(ExportCancelled);
  expect(io.generate).not.toHaveBeenCalled(); expect(io.remove).toHaveBeenCalledWith('old');
});
test('prevents duplicate exports and serializes startup purge with rendering', async () => {
  const { manager, io } = setup();
  let finish!: (uri: string) => void;
  io.generate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const work = manager.pdf('html', () => true);
  while (!finish) await Promise.resolve();
  await expect(manager.pdf('html', () => true)).rejects.toThrow('Başka');
  await manager.cleanup(true); finish('raw');
  await expect(work).rejects.toBeInstanceOf(ExportCancelled);
  expect(io.share).not.toHaveBeenCalled();
});
test('does not truncate oversized text and rejects stale clipboard writes', async () => {
  const { manager, io } = setup();
  await expect(manager.copy('x'.repeat(5_000_001), () => true)).rejects.toThrow();
  await expect(manager.copy('private', () => false)).rejects.toBeInstanceOf(ExportCancelled);
  expect(io.copy).not.toHaveBeenCalled();
  const text = 'İıŞş\n📝'.repeat(2000);
  await manager.copy(text, () => true); expect(io.copy).toHaveBeenCalledWith(text, expect.any(Function));
});
test('refuses unavailable sharing without generating a file', async () => {
  const { manager, io } = setup(); io.available.mockResolvedValue(false);
  await expect(manager.pdf('html', () => true)).rejects.toThrow();
  expect(io.generate).not.toHaveBeenCalled();
});
test('rejects a fourth recent PDF rather than evicting a file still being shared', async () => {
  const { manager, io, now } = setup();
  io.files.mockResolvedValue([1, 2, 3].map(n => ({ uri: String(n), size: 10, modified: now })));
  await expect(manager.pdf('html', () => true)).rejects.toThrow();
  expect(io.remove).not.toHaveBeenCalled(); expect(io.generate).not.toHaveBeenCalled();
});
test('cleans a PDF rejected before sharing; does not delete uncertain native handoff', async () => {
  const { manager, io } = setup();
  io.inspect.mockResolvedValueOnce({ uri: 'raw', size: MAX_PDF_BYTES + 1, modified: 0 });
  await expect(manager.pdf('html', () => true)).rejects.toThrow();
  expect(io.remove).toHaveBeenCalledWith('raw');
  io.remove.mockClear(); io.share.mockImplementationOnce(async (_uri, beforeNative) => {
    beforeNative(); throw new Error('native failure');
  });
  await expect(manager.pdf('html', () => true)).rejects.toThrow();
  expect(io.remove).not.toHaveBeenCalled();
});
test('a failed purge is retried and does not authorize another generation', async () => {
  const { manager, io, now } = setup();
  io.files.mockResolvedValue([{ uri: 'old', size: 100, modified: now }]);
  io.remove.mockRejectedValueOnce(new Error('disk'));
  await expect(manager.cleanup(true)).rejects.toThrow();
  await manager.cleanup(); expect(io.remove).toHaveBeenCalledTimes(2);
});
