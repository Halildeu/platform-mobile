import { OfflineAudioBuffer, type StoredChunk } from '../offlineBuffer';
import { SqliteChunkStore, type SqliteLike } from '../sqliteChunkStore';

/**
 * Minimal in-memory fake of the expo-sqlite sync API — enough to exercise the
 * exact statements SqliteChunkStore issues, so the mapping is verified against
 * the same ChunkStore contract without a device.
 */
class FakeSqlite implements SqliteLike {
  private rows = new Map<number, StoredChunk>();

  execSync(sql: string): void {
    if (/^\s*DELETE\s+FROM/i.test(sql) && !/WHERE/i.test(sql)) this.rows.clear();
    // CREATE TABLE -> no-op
  }
  runSync(sql: string, params: unknown[]): void {
    if (/^\s*INSERT\s+OR\s+REPLACE/i.test(sql)) {
      const [chunkSeq, capturedAtMs, enqueuedAtMs, pcm16] = params as [
        number,
        number,
        number,
        Uint8Array,
      ];
      this.rows.set(chunkSeq, { chunkSeq, capturedAtMs, enqueuedAtMs, pcm16 });
    } else if (/^\s*DELETE\s+FROM/i.test(sql)) {
      this.rows.delete(params[0] as number);
    }
  }
  getAllSync<T>(): T[] {
    return [...this.rows.values()]
      .sort((a, b) => a.chunkSeq - b.chunkSeq)
      .map((c) => ({
        chunk_seq: c.chunkSeq,
        captured_at_ms: c.capturedAtMs,
        enqueued_at_ms: c.enqueuedAtMs,
        pcm16: c.pcm16,
      })) as unknown as T[];
  }
  getFirstSync<T>(sql: string): T | null {
    if (/COUNT/i.test(sql)) return { n: this.rows.size } as unknown as T;
    const first = [...this.rows.values()].sort((a, b) => a.chunkSeq - b.chunkSeq)[0];
    if (!first) return null;
    return {
      chunk_seq: first.chunkSeq,
      captured_at_ms: first.capturedAtMs,
      enqueued_at_ms: first.enqueuedAtMs,
      pcm16: first.pcm16,
    } as unknown as T;
  }
}

const stored = (seq: number): StoredChunk => ({
  chunkSeq: seq,
  capturedAtMs: seq * 20,
  enqueuedAtMs: seq,
  pcm16: new Uint8Array([seq & 0xff, 0]),
});

describe('SqliteChunkStore (ChunkStore sözleşmesi)', () => {
  it('put/list/oldest/remove/size seq sırasını ve idempotency korur', () => {
    const store = new SqliteChunkStore(new FakeSqlite());
    store.put(stored(3));
    store.put(stored(1));
    store.put(stored(3)); // aynı seq -> replace
    expect(store.size()).toBe(2);
    expect(store.list().map((c) => c.chunkSeq)).toEqual([1, 3]);
    expect(store.oldest()?.chunkSeq).toBe(1);
    store.remove(1);
    expect(store.oldest()?.chunkSeq).toBe(3);
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.oldest()).toBeNull();
  });

  it('OfflineAudioBuffer ile birlikte çalışır (drain sıra korur)', () => {
    const buf = new OfflineAudioBuffer({ store: new SqliteChunkStore(new FakeSqlite()) });
    [1, 2, 3].forEach((n) => buf.enqueue({ ...stored(n) }));
    const order: number[] = [];
    buf.drain((c) => {
      order.push(c.chunkSeq);
      return true;
    });
    expect(order).toEqual([1, 2, 3]);
    expect(buf.pending()).toBe(3);
    [1, 2, 3].forEach((seq) => buf.acknowledge(seq));
    expect(buf.pending()).toBe(0);
  });
});
