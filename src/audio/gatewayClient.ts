/**
 * Gateway live WebSocket client (PR-mobile-02 #4 + reconnect from PR-mobile-05 #7).
 *
 * Persistent connection to the audio-gateway session stream: sends PCM16 audio
 * frames out, parses ws-stream events in, and reconnects with exponential
 * backoff on drop. Transport is injected (`socketFactory`) so the reconnect and
 * framing logic is unit-testable without a real socket / device.
 */
import {
  validateWsStreamEvent,
  type WsStreamEvent,
} from '../contracts/wsStreamEvents';
import { encodeGatewayLivePcm16Frame } from './gatewayFrame';

export type GatewayStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Minimal WebSocket surface — the RN global `WebSocket` satisfies this. */
export interface GatewaySocket {
  send(data: ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((error?: unknown) => void) | null;
}

export type GatewaySocketFactory = (url: string) => GatewaySocket;

/** Exponential backoff (attempt 1 -> base, doubling, capped). Pure/testable. */
export function nextBackoffMs(attempt: number, baseMs = 500, maxMs = 10_000): number {
  if (attempt <= 0) return 0;
  return Math.min(maxMs, baseMs * 2 ** (attempt - 1));
}

export interface GatewayClientOptions {
  url: string;
  socketFactory: GatewaySocketFactory;
  onEvent: (event: WsStreamEvent) => void;
  onStatus?: (status: GatewayStatus) => void;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export class GatewayClient {
  private socket: GatewaySocket | null = null;
  private socketOpen = false;
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: GatewayClientOptions) {}

  connect(): void {
    if (this.socket !== null || this.reconnectTimer !== null) return;
    this.closedByUser = false;
    this.open();
  }

  /** Encode + send one PCM16 chunk. Returns false when the socket is down. */
  sendPcm16(chunkSeq: number, capturedAtMs: number, pcm16: Uint8Array): boolean {
    if (!this.socketOpen || this.socket === null) return false;
    this.socket.send(
      encodeGatewayLivePcm16Frame({ chunkSeq, capturedAtMs, pcm16 }),
    );
    return true;
  }

  get isOpen(): boolean {
    return this.socketOpen;
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    this.socketOpen = false;
    this.attempt = 0;
    socket?.close();
    this.opts.onStatus?.('closed');
  }

  private open(): void {
    this.opts.onStatus?.(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const socket = this.opts.socketFactory(this.opts.url);
    this.socket = socket;
    this.socketOpen = false;

    socket.onopen = () => {
      if (this.socket !== socket || this.closedByUser) return;
      this.socketOpen = true;
      this.attempt = 0;
      this.opts.onStatus?.('open');
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || this.closedByUser) return;
      let payload: unknown = event.data;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          return; // ignore non-JSON text frames
        }
      }
      const result = validateWsStreamEvent(payload);
      if (result.ok) this.opts.onEvent(result.event);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // errors are followed by close on RN/browser sockets; reconnect handles it
    };
  }

  private scheduleReconnect(): void {
    this.socket = null;
    this.socketOpen = false;
    if (this.closedByUser) {
      this.opts.onStatus?.('closed');
      return;
    }
    this.attempt += 1;
    const delay = nextBackoffMs(
      this.attempt,
      this.opts.baseBackoffMs,
      this.opts.maxBackoffMs,
    );
    this.opts.onStatus?.('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }
}
