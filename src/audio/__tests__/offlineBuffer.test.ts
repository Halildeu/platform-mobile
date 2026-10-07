import {
  InMemoryChunkStore,
  OfflineAudioBuffer,
  type PendingChunk,
} from '../offlineBuffer';

function chunk(seq: number): PendingChunk {
  return { chunkSeq: seq, capturedAtMs: seq * 20, pcm16: new Uint8Array([seq & 0xff, 0]) };
}

const stored = (seq: number) => ({ ...chunk(seq), enqueuedAtMs: seq });

describe('InMemoryChunkStore', () => {
  it('seq sırasına göre listeler ve aynı seq için tekilleştirir', () => {
    const s = new InMemoryChunkStore();
    s.put(stored(3));
    s.put(stored(1));
    s.put(stored(3)); // aynı seq -> replace
    expect(s.size()).toBe(2);
    expect(s.list().map((c) => c.chunkSeq)).toEqual([1, 3]);
    expect(s.oldest()?.chunkSeq).toBe(1);
  });
});

describe('OfflineAudioBuffer', () => {
  it('enqueue idempotent (aynı chunkSeq iki kez -> tek kayıt)', () => {
    const buf = new OfflineAudioBuffer();
    buf.enqueue(chunk(5));
    buf.enqueue(chunk(5));
    expect(buf.pending()).toBe(1);
  });

  it('kapasite dolunca en eskiyi düşürür', () => {
    const buf = new OfflineAudioBuffer({ maxChunks: 2 });
    buf.enqueue(chunk(1));
    buf.enqueue(chunk(2));
    buf.enqueue(chunk(3)); // 1 düşer
    expect(buf.pending()).toBe(2);
    expect(buf.dropped()).toBe(1);
  });

  it('drain sıra korur fakat teslim onayı gelmeden silmez', () => {
    const buf = new OfflineAudioBuffer();
    [1, 2, 3].forEach((n) => buf.enqueue(chunk(n)));
    const order: number[] = [];
    const res = buf.drain((c) => {
      order.push(c.chunkSeq);
      return true;
    });
    expect(order).toEqual([1, 2, 3]);
    expect(res).toEqual({ sent: 3, remaining: 3 });
    expect(buf.pending()).toBe(3);
    [1, 2, 3].forEach((seq) => buf.acknowledge(seq));
    expect(buf.pending()).toBe(0);
  });

  it('TTL: saklama penceresini aşan parçalar auto-purge edilir (KVKK)', () => {
    let clock = 1_000;
    const buf = new OfflineAudioBuffer({ ttlMs: 100, now: () => clock });
    buf.enqueue(chunk(1)); // t=1000
    clock = 1_050;
    buf.enqueue(chunk(2)); // t=1050, ikisi de taze
    expect(buf.pending()).toBe(2);

    clock = 1_200; // #1 (1000) ve #2 (1050) artık 100ms penceresini aştı
    const purged = buf.purgeExpired();
    expect(purged).toBe(2);
    expect(buf.pending()).toBe(0);
    expect(buf.purged()).toBe(2);
  });

  it('TTL kapalıyken (ttlMs yok) hiçbir şey purge edilmez', () => {
    let clock = 0;
    const buf = new OfflineAudioBuffer({ now: () => clock });
    buf.enqueue(chunk(1));
    clock = 10_000_000;
    expect(buf.purgeExpired()).toBe(0);
    expect(buf.pending()).toBe(1);
  });

  it('gönderim ortada başarısız olursa durur ve kalanı korur', () => {
    const buf = new OfflineAudioBuffer();
    [1, 2, 3].forEach((n) => buf.enqueue(chunk(n)));
    const res = buf.drain((c) => c.chunkSeq < 2); // 2. parçada false
    expect(res.sent).toBe(1);
    expect(res.remaining).toBe(3);
    buf.acknowledge(1);
    expect(buf.pending()).toBe(2); // 2 ve 3 hâlâ kuyrukta

    // Bağlantı geri gelince kalanlar sırayla gider
    const order: number[] = [];
    buf.drain((c) => {
      order.push(c.chunkSeq);
      return true;
    });
    expect(order).toEqual([2, 3]);
  });
});
