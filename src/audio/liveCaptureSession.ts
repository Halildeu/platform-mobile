/**
 * Live capture coordinator (PR-mobile-05, #7).
 *
 * Ties the three audio pieces together with a durability-first policy:
 *   captured PCM16  ->  offline buffer (persist)  ->  gateway (best-effort send)
 *
 * Every chunk is written to the buffer BEFORE we attempt to send it. Chunks stay
 * pending until an authenticated receipt; bounds/TTL may still discard them.
 * `flush` replays queued chunks in seq order;
 * the app wires `onReconnected` to the gateway's `open` status so a reconnect
 * drains whatever accumulated while offline. All I/O is injected (a `send`
 * function + a `ChunkStore`-backed buffer), so this is unit-testable without a
 * device or a real socket.
 */
import { OfflineAudioBuffer, type PendingChunk } from './offlineBuffer';

/** Returns true when the chunk was accepted by the transport (socket up). */
export type PcmSender = (chunk: PendingChunk) => boolean;

export interface LiveCaptureSessionOptions {
  sessionId: string;
  send: PcmSender;
  buffer?: OfflineAudioBuffer;
}

export class LiveCaptureSession {
  private readonly buffer: OfflineAudioBuffer;

  constructor(private readonly opts: LiveCaptureSessionOptions) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(opts.sessionId)) throw new Error('Invalid sessionId');
    this.buffer = opts.buffer ?? new OfflineAudioBuffer();
  }

  /**
   * Ingest one captured PCM16 chunk. Persisted first, then we try to flush the
   * queue (this chunk plus any backlog) in order.
   */
  pushPcm16(chunkSeq: number, capturedAtMs: number, pcm16: Uint8Array): void {
    this.buffer.enqueue({ chunkSeq, capturedAtMs, pcm16 });
    this.flush();
  }

  /** Drain queued chunks through the sender; stops at the first send failure. */
  flush(): void {
    this.buffer.drain(this.opts.send);
  }

  /** Wire to the gateway `open` status so a reconnect replays the backlog. */
  onReconnected(): void {
    this.buffer.resetInFlight();
    this.flush();
  }

  /** Receipt must be verified by the authenticated transport adapter. */
  acknowledge(receipt: { sessionId: string; chunkSeq: number }): void {
    if (receipt.sessionId !== this.opts.sessionId || !Number.isSafeInteger(receipt.chunkSeq) || receipt.chunkSeq < 0) return;
    this.buffer.acknowledge(receipt.chunkSeq);
  }

  pending(): number {
    return this.buffer.pending();
  }

  dropped(): number {
    return this.buffer.dropped();
  }
}
