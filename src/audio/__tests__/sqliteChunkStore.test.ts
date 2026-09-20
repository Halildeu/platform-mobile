import { DatabaseSync } from 'node:sqlite';
import { OfflineAudioBuffer } from '../offlineBuffer';
import { SqliteChunkStore, type SqliteLike } from '../sqliteChunkStore';

function fixture() {
  const db = new DatabaseSync(':memory:');
  const io: SqliteLike = {
    execSync: sql => db.exec(sql),
    runSync: (sql, params) => { db.prepare(sql).run(...params); },
    getFirstSync: <T>(sql: string, params: (string | number | null | Uint8Array)[] = []) => db.prepare(sql).get(...params) as T ?? null,
    getAllSync: <T>(sql: string, params: (string | number | null | Uint8Array)[] = []) => db.prepare(sql).all(...params) as T[],
  };
  return { db, io, store: new SqliteChunkStore(io) };
}
const pcm = (chunkSeq: number) => ({ chunkSeq, capturedAtMs: chunkSeq, pcm16: new Uint8Array([1, 2]) });

test('real SQLite retains ordering and deletes only validated ACKs without loss markers', () => {
  const f = fixture();
  try {
    const buffer = new OfflineAudioBuffer({ store: f.store });
    [3, 1, 2].forEach(n => buffer.enqueue(pcm(n)));
    const sent: number[] = [];
    buffer.drain(c => { sent.push(c.chunkSeq); return true; });
    expect(sent).toEqual([1, 2, 3]); expect(buffer.pending()).toBe(3);
    buffer.acknowledge(1); buffer.acknowledge(2); buffer.acknowledge(3);
    expect(f.store.losses()).toEqual({ expired: 0, evicted: 0 });
    expect(new OfflineAudioBuffer({ store: new SqliteChunkStore(f.io) }).pending()).toBe(0);
  } finally { f.db.close(); }
});
test.each(['expired', 'evicted'] as const)('%s marker and row deletion survive store restart together', reason => {
  const f = fixture();
  try {
    const buffer = new OfflineAudioBuffer({ store: f.store, ttlMs: 10, now: () => 100, maxChunks: 1 });
    buffer.enqueue(pcm(1));
    if (reason === 'expired') {
      new OfflineAudioBuffer({ store: new SqliteChunkStore(f.io), ttlMs: 10, now: () => 110 }).purgeExpired();
    } else buffer.enqueue(pcm(2));
    const restarted = new OfflineAudioBuffer({ store: new SqliteChunkStore(f.io) });
    expect(reason === 'expired' ? restarted.purged() : restarted.dropped()).toBe(1);
    expect(f.store.list().map(c => c.chunkSeq)).toEqual(reason === 'expired' ? [] : [2]);
    f.store.discard(1, reason);
    expect(f.store.losses()[reason]).toBe(1);
  } finally { f.db.close(); }
});
test.each(['delete', 'commit'])('transaction rollback on %s error preserves row and loss counter', failure => {
  const f = fixture();
  try {
    f.store.put({ ...pcm(1), enqueuedAtMs: 1 });
    if (failure === 'delete') f.db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON pending_audio_chunks BEGIN SELECT RAISE(ABORT, 'disk failure'); END;");
    else {
      const exec = f.io.execSync;
      f.io.execSync = sql => { if (sql === 'COMMIT') throw new Error('commit failed'); exec(sql); };
    }
    expect(() => f.store.discard(1, 'expired')).toThrow();
    expect(new SqliteChunkStore(f.io).size()).toBe(1);
    expect(f.store.losses()).toEqual({ expired: 0, evicted: 0 });
  } finally { f.db.close(); }
});
test('purged empty buffer cannot forget loss after reopening', () => {
  const f = fixture();
  try {
    f.store.put({ ...pcm(1), enqueuedAtMs: 1 });
    new OfflineAudioBuffer({ store: f.store, ttlMs: 1, now: () => 2 }).purgeExpired();
    const reopened = new OfflineAudioBuffer({ store: new SqliteChunkStore(f.io) });
    expect(reopened.pending()).toBe(0); expect(reopened.purged()).toBe(1);
  } finally { f.db.close(); }
});
