/**
 * SQLite-backed ChunkStore (PR-mobile-05, #7) — on-device persistence.
 *
 * Concrete `ChunkStore` for the phone: survives app kill / crash so buffered
 * audio can be discovered after a cold restart. Recovery UI/transport is a
 * separate integration; persistence alone does not prove replay. The
 * queue/TTL/eviction POLICY lives in `OfflineAudioBuffer` (unit-tested); this
 * file is only the storage mapping.
 *
 * Runtime boundary:
 *  - Runs on-device (expo-sqlite). It is NOT exercised by the jest unit run —
 *    it is verified on a device/emulator (Detox/Maestro + manual).
 *  - The SQLite handle is INJECTED (`SqliteLike`) so the mapping stays decoupled
 *    from the Expo global and could be faked in an integration test.
 *
 * KVKK at-rest encryption (ADR-0030):
 *  - PCM16 audio is sensitive. At-rest encryption requires a SQLCipher-enabled
 *    build keyed from `expo-secure-store` (see `openEncryptedChunkDb` note).
 *    That is a native/build concern; wire it at the open() call site, not here.
 */
import type { ChunkStore, StoredChunk } from './offlineBuffer';

/** Minimal subset of the expo-sqlite (v15) synchronous API this store needs. */
export interface SqliteLike {
  execSync(sql: string): void;
  runSync(sql: string, params: (string | number | null | Uint8Array)[]): void;
  getAllSync<T>(sql: string, params?: (string | number | null | Uint8Array)[]): T[];
  getFirstSync<T>(sql: string, params?: (string | number | null | Uint8Array)[]): T | null;
}

interface ChunkRow {
  chunk_seq: number;
  captured_at_ms: number;
  enqueued_at_ms: number;
  pcm16: Uint8Array;
}

const TABLE = 'pending_audio_chunks';

function rowToChunk(row: ChunkRow): StoredChunk {
  if (!Number.isSafeInteger(row.chunk_seq) || row.chunk_seq < 0 ||
      !Number.isSafeInteger(row.captured_at_ms) || row.captured_at_ms < 0 ||
      !Number.isSafeInteger(row.enqueued_at_ms) || row.enqueued_at_ms < 0 ||
      !(row.pcm16 instanceof Uint8Array) || !row.pcm16.byteLength ||
      row.pcm16.byteLength > 65534 || row.pcm16.byteLength % 2 !== 0) {
    throw new Error('Kaydedilmiş ses parçası doğrulanamadı.');
  }
  return {
    chunkSeq: row.chunk_seq,
    capturedAtMs: row.captured_at_ms,
    enqueuedAtMs: row.enqueued_at_ms,
    pcm16: row.pcm16,
  };
}

export class SqliteChunkStore implements ChunkStore {
  constructor(private readonly db: SqliteLike, mode: 'create' | 'existing' = 'create') {
    if (mode === 'existing') {
      // Missing tables/counters are evidence of unreadable storage, not an empty queue.
      // Recovery and cleanup must never repair them with CREATE or INSERT defaults.
      this.losses(); this.list(); this.size();
      return;
    }
    // chunk_seq is the idempotency key (per CLAUDE.md rule 3, scoped per session db).
    this.db.execSync(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (
         chunk_seq      INTEGER PRIMARY KEY,
         captured_at_ms INTEGER NOT NULL,
         enqueued_at_ms INTEGER NOT NULL,
         pcm16          BLOB    NOT NULL
       )`,
    );
    this.db.execSync(`CREATE TABLE IF NOT EXISTS audio_buffer_loss (
      id INTEGER PRIMARY KEY CHECK (id = 1), expired INTEGER NOT NULL, evicted INTEGER NOT NULL);
      INSERT OR IGNORE INTO audio_buffer_loss (id, expired, evicted) VALUES (1, 0, 0);`);
  }

  losses(): { expired: number; evicted: number } {
    const row = this.db.getFirstSync<{ expired: number; evicted: number }>('SELECT expired, evicted FROM audio_buffer_loss WHERE id = 1');
    if (!row || !Number.isSafeInteger(row.expired) || row.expired < 0 || !Number.isSafeInteger(row.evicted) || row.evicted < 0) {
      throw new Error('Ses kaybı kaydı okunamadı.');
    }
    return row;
  }

  discard(chunkSeq: number, reason: 'expired' | 'evicted'): void {
    if (!['expired', 'evicted'].includes(reason)) throw new Error('Geçersiz silme nedeni.');
    this.db.execSync('BEGIN IMMEDIATE');
    try {
      // Count only an existing row; repeated cleanup cannot double-count a loss.
      this.db.runSync(`UPDATE audio_buffer_loss SET ${reason} = ${reason} +
        (SELECT COUNT(*) FROM ${TABLE} WHERE chunk_seq = ?) WHERE id = 1`, [chunkSeq]);
      this.remove(chunkSeq);
      this.db.execSync('COMMIT');
    } catch (error) {
      try { this.db.execSync('ROLLBACK'); } catch { /* caller treats storage as failed */ }
      throw error;
    }
  }

  put(chunk: StoredChunk): void {
    this.db.runSync(
      `INSERT OR REPLACE INTO ${TABLE}
         (chunk_seq, captured_at_ms, enqueued_at_ms, pcm16)
       VALUES (?, ?, ?, ?)`,
      [chunk.chunkSeq, chunk.capturedAtMs, chunk.enqueuedAtMs, chunk.pcm16],
    );
  }

  list(): StoredChunk[] {
    const chunks = this.db
      .getAllSync<ChunkRow>(`SELECT * FROM ${TABLE} ORDER BY chunk_seq ASC`)
      .map(rowToChunk);
    if (chunks.some((chunk, index) => index > 0 && chunk.chunkSeq <= chunks[index - 1].chunkSeq)) {
      throw new Error('Kaydedilmiş ses sırası doğrulanamadı.');
    }
    return chunks;
  }

  remove(chunkSeq: number): void {
    this.db.runSync(`DELETE FROM ${TABLE} WHERE chunk_seq = ?`, [chunkSeq]);
  }

  oldest(): StoredChunk | null {
    const row = this.db.getFirstSync<ChunkRow>(
      `SELECT * FROM ${TABLE} ORDER BY chunk_seq ASC LIMIT 1`,
    );
    return row ? rowToChunk(row) : null;
  }

  clear(): void {
    this.db.execSync(`DELETE FROM ${TABLE}`);
  }

  size(): number {
    const row = this.db.getFirstSync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${TABLE}`,
    );
    if (!row || !Number.isSafeInteger(row.n) || row.n < 0) throw new Error('Ses kuyruğu sayısı doğrulanamadı.');
    return row.n;
  }
}
