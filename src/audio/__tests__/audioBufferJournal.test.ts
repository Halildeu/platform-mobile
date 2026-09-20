import { createHash } from 'node:crypto';
import { AudioBufferJournal, type BufferRecord } from '../audioBufferJournal';
const digest = async (value: string) => createHash('sha256').update(value).digest('hex');
function fixture() {
  let value: string | null = null;
  const io = { read: jest.fn(async () => value), write: jest.fn(async (next: string) => { value = next; }) };
  return { journal: new AudioBufferJournal(io, digest), io, set: (v: string) => { value = v; }, value: () => value };
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
  await expect(f.journal.edit(extra.id, f.journal.acquire(extra.id)!, () => extra)).rejects.toThrow();
  expect(f.value()).toBe(prior);
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
