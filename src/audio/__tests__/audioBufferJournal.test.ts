import { createHash } from 'node:crypto';
import { AudioBufferJournal, type BufferRecord } from '../audioBufferJournal';
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
function fixture() {
  let value: string | null = null;
  let losses: string | null = null;
  const io = { read: jest.fn(async () => value), write: jest.fn(async (next: string) => { value = next; }) };
  const lossIo = { read: jest.fn(async () => losses), write: jest.fn(async (next: string) => { losses = next; }) };
  return { journal: new AudioBufferJournal(io, digest, lossIo), io, lossIo, set: (v: string) => { value = v; }, value: () => value };
}
async function record(journal: AudioBufferJournal, sessionId = 'SES-one'): Promise<BufferRecord> {
  const ownerHash = 'a'.repeat(64);
  return { id: await journal.identity(ownerHash, sessionId), ownerHash, sessionId, retentionMs: 1000, state: 'creating' };
}
test('creating survives process restart and blocks HTTP completion; drained permits it', async () => {
  const f = fixture(); const row = await record(f.journal); const lease = f.journal.acquire(row.id)!;
  await f.journal.edit(row.id, lease, () => row);
  const restarted = new AudioBufferJournal(f.io, digest);
  await expect(restarted.assertFinishAllowed(row.ownerHash, row.sessionId)).rejects.toThrow('Bekleyen');
  await f.journal.edit(row.id, lease, r => ({ ...r!, state: 'drained' }));
  await expect(restarted.assertFinishAllowed(row.ownerHash, row.sessionId)).resolves.toBeUndefined();
});
test.each(['ready', 'lost', 'deleting'] as const)('%s never becomes empty-success', async state => {
  const f = fixture(); const row = await record(f.journal); const lease = f.journal.acquire(row.id)!;
  await f.journal.edit(row.id, lease, () => ({ ...row, state, ...(state === 'deleting' ? { outcome: 'lost' as const } : {}) }));
  await expect(f.journal.assertFinishAllowed(row.ownerHash, row.sessionId)).rejects.toThrow('Bekleyen');
});
test('missing means successful read with no matching entry; locked/corrupt storage fails closed', async () => {
  const f = fixture(); const row = await record(f.journal);
  await expect(f.journal.assertFinishAllowed(row.ownerHash, row.sessionId)).resolves.toBeUndefined();
  f.io.read.mockRejectedValueOnce(new Error('locked'));
  await expect(f.journal.assertFinishAllowed(row.ownerHash, row.sessionId)).rejects.toThrow('doğrulanamadı');
  f.set('{broken');
  await expect(f.journal.assertFinishAllowed(row.ownerHash, row.sessionId)).rejects.toThrow('doğrulanamadı');
});
test('readback mismatch preserves stored intent and never reports a successful mutation', async () => {
  const f = fixture(); const row = await record(f.journal); const lease = f.journal.acquire(row.id)!;
  f.io.read.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
  await expect(f.journal.edit(row.id, lease, () => row)).rejects.toThrow('doğrulanamadı');
  expect(await f.journal.list()).toEqual([row]);
});
test('four entries are bounded; fifth never evicts pending metadata', async () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) {
    const row = await record(f.journal, `SES-${i}`);
    await f.journal.edit(row.id, f.journal.acquire(row.id)!, () => row);
  }
  const prior = f.value(); const extra = await record(f.journal, 'SES-fifth');
  await expect(f.journal.assertCapacity()).rejects.toThrow('AUDIO_CAPACITY');
  await expect(f.journal.edit(extra.id, f.journal.acquire(extra.id)!, () => extra)).rejects.toThrow('AUDIO_CAPACITY');
  expect(f.value()).toBe(prior);
});

test('preflight does not reserve capacity: concurrent insertion still rejects at four', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) {
    const row = await record(f.journal, `SES-${i}`);
    await f.journal.edit(row.id, f.journal.acquire(row.id)!, () => row);
  }
  await f.journal.assertCapacity(); await f.journal.assertCapacity();
  const a = await record(f.journal, 'SES-fourth');
  const b = await record(f.journal, 'SES-fifth');
  await f.journal.edit(a.id, f.journal.acquire(a.id)!, () => a);
  await expect(f.journal.edit(b.id, f.journal.acquire(b.id)!, () => b)).rejects.toThrow('AUDIO_CAPACITY');
  expect(await f.journal.list()).toHaveLength(4);
});
test('identity, state and policy are validated before paths can be derived', async () => {
  const f = fixture(); const row = await record(f.journal);
  for (const patch of [{ id: 'b'.repeat(64) }, { ownerHash: '../../x' }, { sessionId: '../x' },
    { retentionMs: 0 }, { state: 'deleting' }, { state: 'ready', outcome: 'drained' }, { rawAudio: 'bad' }]) {
    f.set(JSON.stringify({ version: 1, records: [{ ...row, ...patch }] }));
    await expect(f.journal.list()).rejects.toThrow();
  }
});
test('lease excludes parallel open/sweep and stale release/mutation', async () => {
  const f = fixture(); const row = await record(f.journal); const first = f.journal.acquire(row.id)!;
  expect(f.journal.acquire(row.id)).toBeNull();
  f.journal.release(row.id, first);
  const second = f.journal.acquire(row.id)!;
  await expect(f.journal.edit(row.id, first, () => row)).rejects.toThrow();
  expect(() => f.journal.release(row.id, first)).toThrow();
  await f.journal.edit(row.id, second, () => row);
});
test('parallel edits cannot overwrite another owner/session record', async () => {
  const f = fixture(); const a = await record(f.journal); const b = await record(f.journal, 'SES-two');
  await Promise.all([a, b].map(row => f.journal.edit(row.id, f.journal.acquire(row.id)!, () => row)));
  expect((await f.journal.list()).map(r => r.id).sort()).toEqual([a.id, b.id].sort());
});

test('native storage diagnostics cannot leak into user-visible errors', async () => {
  const f = fixture(); const row = await record(f.journal); const lease = f.journal.acquire(row.id)!;
  f.io.write.mockRejectedValueOnce(new Error('PRIVATE_KEY_AND_NATIVE_PATH'));
  await expect(f.journal.edit(row.id, lease, () => row)).rejects.toThrow('Ses tamponu dizini doğrulanamadı');
});

test.each(['archive-write', 'archive-readback', 'journal-write', 'journal-readback'] as const)(
  'loss transfer survives %s failure without a gap in finish protection', async failure => {
    const f = fixture(); const row = { ...await record(f.journal), state: 'lost' as const };
    const lease = f.journal.acquire(row.id)!;
    await f.journal.edit(row.id, lease, () => row);
    if (failure === 'archive-write') f.lossIo.write.mockRejectedValueOnce(new Error('locked'));
    if (failure === 'archive-readback') f.lossIo.read.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('locked'));
    if (failure === 'journal-write') f.io.write.mockRejectedValueOnce(new Error('locked'));
    if (failure === 'journal-readback') f.io.read.mockResolvedValueOnce(f.value()).mockRejectedValueOnce(new Error('locked'));
    await expect(f.journal.archiveLost(row, lease)).rejects.toThrow();
    const restarted = new AudioBufferJournal(f.io, digest, f.lossIo);
    await expect(restarted.assertFinishAllowed(row.ownerHash, row.sessionId)).rejects.toThrow('Bekleyen');
    await f.journal.archiveLost(row, lease);
    expect(await restarted.list()).toEqual([]);
    expect(await restarted.hasLoss(row.ownerHash, row.sessionId)).toBe(true);
    await expect(f.journal.edit(row.id, lease, () => ({ ...row, state: 'creating' }))).rejects.toThrow();
    await f.journal.forgetLoss(row.id, lease);
    expect(await restarted.hasLoss(row.ownerHash, row.sessionId)).toBe(false);
  },
);

test('archived history is bounded and never evicted to admit another loss marker', async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) {
    const row = { ...await record(f.journal, `SES-history-${i}`), state: 'lost' as const };
    const lease = f.journal.acquire(row.id)!;
    await f.journal.edit(row.id, lease, () => row); await f.journal.archiveLost(row, lease);
    f.journal.release(row.id, lease);
  }
  expect(await f.journal.lossHistory()).toHaveLength(20);
  await expect(f.journal.assertCapacity()).rejects.toThrow('AUDIO_HISTORY_CAPACITY');
  const row = { ...await record(f.journal, 'SES-extra'), state: 'lost' as const };
  const lease = f.journal.acquire(row.id)!;
  await f.journal.edit(row.id, lease, () => row);
  await expect(f.journal.archiveLost(row, lease)).rejects.toThrow('AUDIO_HISTORY_CAPACITY');
  expect(await f.journal.list()).toEqual([row]);
  expect(await f.journal.lossHistory()).toHaveLength(20);
});

test('corrupt history cannot become absent loss evidence', async () => {
  const f = fixture(); const row = await record(f.journal);
  f.lossIo.read.mockResolvedValue('{broken');
  await expect(f.journal.assertFinishAllowed(row.ownerHash, row.sessionId)).rejects.toThrow();
  await expect(f.journal.assertCapacity()).rejects.toThrow();
});
