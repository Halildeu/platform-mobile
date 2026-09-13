/**
 * Offline audio buffer (PR-mobile-05, #7).
 *
 * When the gateway WebSocket drops, captured PCM16 chunks must not be lost:
 * they are queued and replayed in order on reconnect. Per CLAUDE.md rule 3 the
 * idempotency key is (sessionId + chunkSeq); the on-device store is SQLite
 * (expo-sqlite), but the queue logic here is storage-agnostic so it can be
 * unit-tested without a device — the SQLite adapter just implements `ChunkStore`.
 */

export interface PendingChunk {
  chunkSeq: number;
  capturedAtMs: number;
  pcm16: Uint8Array;
}

/** Stored form: a pending chunk plus the wall-clock time it was buffered (for TTL). */
export interface StoredChunk extends PendingChunk {
  enqueuedAtMs: number;
}

/**
 * Persistence surface for pending chunks. Implementations MUST keep chunks
 * ordered by `chunkSeq` and treat `chunkSeq` as a unique key within a session.
 */
export interface ChunkStore {
  /** Insert, or replace an existing chunk with the same chunkSeq (idempotent). */
  put(chunk: StoredChunk): void;
  /** All pending chunks, ascending by chunkSeq. */
  list(): StoredChunk[];
  /** Remove one chunk by seq (called after the gateway confirms delivery). */
  remove(chunkSeq: number): void;
  /** Oldest (lowest chunkSeq) pending chunk, or null. */
  oldest(): StoredChunk | null;
  clear(): void;
  size(): number;
}

/** In-memory ChunkStore — default before SQLite is wired, and used in tests. */
export class InMemoryChunkStore implements ChunkStore {
  private readonly chunks = new Map<number, StoredChunk>();

  put(chunk: StoredChunk): void {
    this.chunks.set(chunk.chunkSeq, chunk);
  }
  list(): StoredChunk[] {
    return [...this.chunks.values()].sort((a, b) => a.chunkSeq - b.chunkSeq);
  }
  remove(chunkSeq: number): void {
    this.chunks.delete(chunkSeq);
  }
  oldest(): StoredChunk | null {
    let min: StoredChunk | null = null;
    for (const c of this.chunks.values()) {
      if (min === null || c.chunkSeq < min.chunkSeq) min = c;
    }
    return min;
  }
  clear(): void {
    this.chunks.clear();
  }
  size(): number {
    return this.chunks.size;
  }
}

export interface OfflineAudioBufferOptions {
  store?: ChunkStore;
  /** Bounded to protect device storage/memory; oldest chunks drop when full. */
  maxChunks?: number;
  /** PCM byte limit, independent of frame count. */
  maxBytes?: number;
  /**
   * KVKK retention window (ADR-0030): buffered audio older than this is
   * auto-purged. Undefined/0 disables TTL purging. Compared against
   * `enqueuedAtMs` (buffer time), not the audio timestamp.
   */
  ttlMs?: number;
  /** Injectable wall clock (defaults to Date.now) — makes TTL unit-testable. */
  now?: () => number;
}

export interface DrainResult {
  /** Chunks handed to transport; NOT proof of gateway admission. */
  sent: number;
  /** Chunks still pending (sender returned false or was not reached). */
  remaining: number;
}

const DEFAULT_MAX_CHUNKS = 2_000; // ~ a few minutes of 20ms PCM16 frames

export class OfflineAudioBuffer {
  private readonly inFlight = new Set<number>();
  private readonly store: ChunkStore;
  private readonly maxChunks: number;
  private readonly ttlMs: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private droppedTotal = 0;
  private purgedTotal = 0;

  constructor(options: OfflineAudioBufferOptions = {}) {
    this.store = options.store ?? new InMemoryChunkStore();
    this.maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    this.ttlMs = options.ttlMs ?? 0;
    if (!Number.isSafeInteger(this.maxChunks) || this.maxChunks < 1 || !Number.isSafeInteger(this.maxBytes) || this.maxBytes < 2 ||
      !Number.isSafeInteger(this.ttlMs) || this.ttlMs < 0) throw new Error('Invalid buffer bounds');
    this.now = options.now ?? Date.now;
  }

  /**
   * Queue immutable audio. An identical retry preserves its original retention
   * timestamp; conflicting reuse of a sequence is rejected. Expired chunks are
   * auto-purged first (KVKK), then the buffer is bounded by dropping the oldest.
   */
  enqueue(chunk: PendingChunk): void {
    if (!Number.isSafeInteger(chunk.chunkSeq) || chunk.chunkSeq < 0 || !Number.isSafeInteger(chunk.capturedAtMs) || chunk.capturedAtMs < 0 ||
      !chunk.pcm16.length || chunk.pcm16.length % 2 || chunk.pcm16.length > this.maxBytes) throw new Error('Invalid PCM chunk');
    this.purgeExpired();
    const existing = this.store.list().find((item) => item.chunkSeq === chunk.chunkSeq);
    if (existing) {
      if (existing.capturedAtMs !== chunk.capturedAtMs || existing.pcm16.length !== chunk.pcm16.length ||
          existing.pcm16.some((byte, index) => byte !== chunk.pcm16[index])) {
        throw new Error('Chunk sequence cannot be reused with different audio');
      }
      return; // retries do not extend retention or replace in-flight audio
    }
    this.store.put({ ...chunk, pcm16: chunk.pcm16.slice(), enqueuedAtMs: this.now() });
    while (this.store.size() > this.maxChunks || this.bytes() > this.maxBytes) {
      const oldest = this.store.oldest();
      if (oldest === null) break;
      this.store.remove(oldest.chunkSeq);
      this.inFlight.delete(oldest.chunkSeq);
      this.droppedTotal += 1;
    }
  }

  /**
   * Remove chunks whose retention window has elapsed. Called automatically on
   * enqueue; also safe to invoke on a timer for a purely idle session. No-op
   * when TTL is disabled. Returns the number purged.
   */
  purgeExpired(): number {
    if (this.ttlMs <= 0) return 0;
    const cutoff = this.now() - this.ttlMs;
    let purged = 0;
    for (const chunk of this.store.list()) {
      if (chunk.enqueuedAtMs <= cutoff) {
        this.store.remove(chunk.chunkSeq);
        this.inFlight.delete(chunk.chunkSeq);
        purged += 1;
      }
    }
    this.purgedTotal += purged;
    return purged;
  }

  /**
   * Flush pending chunks in seq order through `send`. `send` returns true when
   * the chunk was accepted (socket up); on the first false we stop and keep the
   * rest queued, preserving order for the next drain. Successful sends remain
   * pending until acknowledge() receives verified delivery evidence.
   */
  drain(send: (chunk: PendingChunk) => boolean): DrainResult {
    this.purgeExpired();
    let sent = 0;
    for (const chunk of this.store.list()) {
      if (this.inFlight.has(chunk.chunkSeq)) continue;
      // Mark before send: a synchronous receipt callback may acknowledge it.
      this.inFlight.add(chunk.chunkSeq);
      try {
        if (!send(chunk)) { this.inFlight.delete(chunk.chunkSeq); break; }
      } catch {
        this.inFlight.delete(chunk.chunkSeq);
        break;
      }
      sent += 1;
    }
    return { sent, remaining: this.store.size() };
  }

  /** Call only after a validated server receipt, never from socket.send(). */
  acknowledge(chunkSeq: number): void {
    if (!this.inFlight.has(chunkSeq)) return;
    this.store.remove(chunkSeq);
    this.inFlight.delete(chunkSeq);
  }

  /** Unacknowledged chunks become eligible for replay on a new connection. */
  resetInFlight(): void {
    this.inFlight.clear();
  }

  pending(): number {
    return this.store.size();
  }
  bytes(): number { return this.store.list().reduce((total, chunk) => total + chunk.pcm16.byteLength, 0); }

  /** Count of chunks discarded due to the capacity bound (telemetry). */
  dropped(): number {
    return this.droppedTotal;
  }

  /** Count of chunks purged for exceeding the KVKK retention window (telemetry). */
  purged(): number {
    return this.purgedTotal;
  }

  clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }
}
