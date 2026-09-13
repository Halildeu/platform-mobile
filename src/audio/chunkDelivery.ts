import { LiveCaptureSession } from './liveCaptureSession';
import { OfflineAudioBuffer, type PendingChunk } from './offlineBuffer';

/** Socket-local receipt adapter. audio_ack means gateway admission, NOT a persisted transcript. */
export class ChunkDelivery {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private stopped = false;
  private ready = false;
  private readonly capture: LiveCaptureSession;
  constructor(private readonly options: {
    sessionId: string; buffer: OfflineAudioBuffer;
    send(chunk: PendingChunk): boolean;
    reconnect(): void; onExhausted(): void;
    onGap(): void;
    maxRetries?: number;
  }) {
    if (!Number.isSafeInteger(options.maxRetries ?? 5) || (options.maxRetries ?? 5) < 0) throw new Error('Invalid retry limit');
    this.capture = new LiveCaptureSession({ sessionId: options.sessionId, buffer: options.buffer,
      send: (chunk) => this.ready && !this.stopped && options.send(chunk) });
  }
  /** Bind callbacks to the returned connection generation, never just to a session ID. */
  connection(): number { this.ready = false; return ++this.generation; }
  serverReady(generation: number): void {
    if (this.stopped || generation !== this.generation) return;
    if (this.options.buffer.purgeExpired() > 0) { this.stop(); this.options.onGap(); return; }
    clearTimeout(this.timer); this.timer = undefined;
    this.ready = true;
    this.capture.onReconnected();
  }
  receipt(generation: number, raw: unknown): void {
    if (this.stopped || !this.ready || generation !== this.generation || typeof raw !== 'string' || raw.length > 256) return;
    let event: unknown;
    try { event = JSON.parse(raw); } catch { return; }
    if (!event || typeof event !== 'object') return;
    const value = event as Record<string, unknown>;
    if (Object.keys(value).length !== 2 || value.type !== 'audio_ack' || !Number.isSafeInteger(value.chunk_seq) || (value.chunk_seq as number) < 0) return;
    const before = this.options.buffer.pending();
    this.capture.acknowledge({ sessionId: this.options.sessionId, chunkSeq: value.chunk_seq as number });
    if (this.options.buffer.pending() < before) this.attempts = 0;
  }
  push(chunk: PendingChunk): void {
    if (this.stopped) throw new Error('Delivery is stopped');
    const loss = this.options.buffer.dropped() + this.options.buffer.purged();
    this.options.buffer.enqueue(chunk);
    if (loss !== this.options.buffer.dropped() + this.options.buffer.purged()) {
      this.stop(); this.options.onGap(); return;
    }
    this.capture.flush();
  }
  disconnected(generation: number): void {
    if (this.stopped || generation !== this.generation || this.timer) return;
    this.ready = false;
    ++this.generation; // Discard late ready/receipt/close callbacks from this connection.
    if (this.attempts >= (this.options.maxRetries ?? 5)) { this.stop(); this.options.onExhausted(); return; }
    const delay = Math.min(500 * 2 ** this.attempts++, 10000);
    this.timer = setTimeout(() => { this.timer = undefined; if (!this.stopped) this.options.reconnect(); }, delay);
  }
  stop(): void { this.stopped = true; this.ready = false; ++this.generation; clearTimeout(this.timer); this.timer = undefined; }
}
