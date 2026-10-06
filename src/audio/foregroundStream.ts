import { encodeGatewayLivePcm16Frame } from './gatewayFrame';
import { OfflineAudioBuffer } from './offlineBuffer';
import { readSpeakerAttribution, type SpeakerAttribution } from '../transcript/speakerAttribution';

export interface LiveText {
  /** Client-local socket generation within this recording; never a provider source epoch. */
  connectionId?: number;
  seq: number; text: string; final: boolean; confirmed?: string; tentative?: string;
  speakerAttribution?: SpeakerAttribution; sourceStartSample?: number; sourceEndSample?: number;
}
export interface LiveSocket {
  readyState: number;
  bufferedAmount: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event?: { code?: number; reason?: string }) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(): void;
}

/** Gateway receipts authorize deletion; any observed audio loss prevents successful drain. */
export class ForegroundStream {
  private ready = false;
  private stopping = false;
  private finished = false;
  private seq = 0;
  private opened = false;
  private transportError = false;
  private eofSent = false;
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private waitingSince: number | undefined;
  private errorTimer: ReturnType<typeof setTimeout> | undefined;
  private stopResolve: ((drained: boolean) => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnecting = false;
  private everReady = false;
  private connectionGeneration = 0;
  private retries = 0;
  private continuityLost = false;
  /** Same uninterrupted provider bridge, not merely the most recent gateway receipt. */
  completionConfirmed(): boolean { return !!this.telemetry.drainedUtc && !this.continuityLost; }
  private telemetry = { capturedBuffers: 0, capturedBytes: 0, sentFrames: 0, acknowledgedFrames: 0,
    lastSentSeq: -1, lastAckSeq: -1, partialEvents: 0, finalEvents: 0,
    lastCaptureUtc: '', lastSendUtc: '', lastAckUtc: '', lastTextUtc: '',
    eofUtc: '', drainedUtc: '', closeCode: 0 };

  diagnostics() {
    return { ...this.telemetry, generatedFrames: this.seq, pendingFrames: this.pendingFrames(),
      expiredFrames: this.buffer?.purged() ?? 0, evictedFrames: this.buffer?.dropped() ?? 0,
      deliveryReceiptsAvailable: !!this.buffer, reconnectAttempts: this.retries, continuityLost: this.continuityLost };
  }

  private pendingFrames(): number | null {
    try { return this.buffer?.pending() ?? 0; }
    catch { return null; } // Unknown must not look like an empty, fully delivered queue.
  }

  private guard(work: () => void): void {
    if (this.finished) return;
    try { work(); }
    catch { this.fail('Ses akışı işlenemedi; eksiksiz teslim doğrulanamadı.'); }
  }

  private bufferIntact(purge = true): boolean {
    if (this.finished) return false;
    if (!this.buffer) return true;
    try {
      if (purge) this.buffer.purgeExpired();
      // Cumulative evidence also covers a separate TTL timer or a previous drain.
      // Never reset it on reconnect, a late receipt, or an empty queue.
      if (this.buffer.purged() > 0) {
        this.fail('Ses saklama süresi doldu; eksiksiz teslim doğrulanamadı.'); return false;
      }
      if (this.buffer.dropped() > 0) {
        this.fail('Ses tamponu sınırına ulaşıldı; kayıp oluştuğu için test durduruldu.'); return false;
      }
      this.buffer.pending(); // Detect a closed/unreadable adapter even without TTL.
      return true;
    } catch {
      this.fail('Ses tamponuna erişilemedi; eksiksiz teslim doğrulanamadı.'); return false;
    }
  }

  constructor(
    private socket: LiveSocket,
    private readonly onReady: () => void,
    private readonly onText: (text: LiveText) => void,
    private readonly onFailure: (message: string) => void,
    private readonly buffer?: OfflineAudioBuffer,
    private readonly recovery?: {
      connect(): Promise<LiveSocket>;
      onStatus(message: string): void;
      onConnectionInterrupted?(connectionId: number): void;
    },
  ) {
    this.bind(socket);
  }

  private bind(socket: LiveSocket): void {
    this.socket = socket;
    const generation = ++this.connectionGeneration;
    this.opened = false;
    this.transportError = false;
    this.errorTimer = undefined;
    this.timer = setTimeout(() => this.guard(() => this.reconnecting ? this.closed(1006) : this.fail('Ses sunucusu hazır olmadı.')), 15000);
    socket.onmessage = (event) => { if (generation === this.connectionGeneration) this.guard(() => this.receive(event.data)); };
    socket.onopen = () => { if (generation === this.connectionGeneration) this.opened = true; };
    socket.onerror = () => {
      if (generation !== this.connectionGeneration || this.finished) return;
      // Native transports often emit close with a useful code immediately after error.
      this.transportError = true;
      if (!this.errorTimer) this.errorTimer = setTimeout(() => this.guard(() => this.closed()), 500);
    };
    socket.onclose = (event) => {
      if (!this.finished && generation === this.connectionGeneration) this.guard(() => this.closed(event?.code));
    };
  }

  send(data: ArrayBuffer, sampleRate: number, channels: number, capturedAtMs: number): boolean {
    this.telemetry.capturedBuffers++;
    this.telemetry.capturedBytes += data.byteLength;
    this.telemetry.lastCaptureUtc = new Date().toISOString();
    const recovering = !!this.recovery && !!this.buffer && this.everReady && (this.reconnecting || this.transportError);
    if ((!this.ready && !recovering) || this.stopping || this.finished || (this.transportError && !recovering)) return false;
    if (!this.bufferIntact()) return false;
    if (sampleRate !== 16000 || channels !== 1 || !data.byteLength || data.byteLength % 2 !== 0) {
      this.fail('Mikrofon gerekli ses biçimini sağlayamadı. Test durduruldu.');
      return false;
    }
    if ((!recovering && this.socket.readyState !== 1) || (!this.buffer && this.socket.bufferedAmount > 128000)) {
      this.fail('Bağlantı ses hızına yetişemedi. Test durduruldu.');
      return false;
    }
    try {
      const bytes = new Uint8Array(data);
      for (let offset = 0; offset < bytes.length; offset += 32000) {
        const chunk = { chunkSeq: this.seq++, capturedAtMs, pcm16: bytes.subarray(offset, offset + 32000) };
        if (this.buffer) {
          this.buffer.enqueue(chunk);
          if (!this.bufferIntact()) return false;
          if (this.waitingSince === undefined) this.waitingSince = Date.now();
          this.flushQueue();
          if (this.finished) return false;
        } else { this.socket.send(encodeGatewayLivePcm16Frame(chunk)); this.sent(chunk.chunkSeq); }
      }
      return true;
    } catch {
      this.fail('Ses gönderilemedi. Test durduruldu.');
      return false;
    }
  }

  stop(): Promise<boolean> {
    if (this.finished || this.stopping) return Promise.resolve(false);
    if (!this.bufferIntact()) return Promise.resolve(false);
    this.stopping = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.recoveryTimer);
    if (this.reconnecting) ++this.connectionGeneration;
    this.ready = false;
    clearTimeout(this.timer);
    clearTimeout(this.errorTimer);
    return new Promise((resolve) => {
      this.stopResolve = resolve;
      this.timer = setTimeout(() => this.fail('Son metin onayı alınamadı.'), 12000);
      this.guard(() => this.sendEofWhenAcknowledged());
    });
  }

  dispose(): void {
    if (this.finished) return;
    this.finished = true;
    ++this.connectionGeneration;
    clearTimeout(this.retryTimer);
    clearTimeout(this.recoveryTimer);
    this.ready = false;
    clearTimeout(this.timer);
    clearTimeout(this.errorTimer);
    clearInterval(this.flushTimer);
    this.stopResolve?.(false);
    this.stopResolve = undefined;
    try { this.socket.close(); } catch { /* Cleanup and failure delivery must still complete. */ }
  }

  private fail(message: string): void {
    if (this.finished) return;
    const pending = this.pendingFrames();
    this.dispose();
    const detail = pending === null ? '\nBekleyen ses parçası sayısı okunamadı; teslim doğrulanmadı.'
      : pending > 0 ? `\nGateway teslim onayı bekleyen ses parçası: ${pending}. Eksiksiz teslim doğrulanmadı.` : '';
    try { this.onFailure(message + detail); } catch { /* Transport is already stopped; never re-enter failure. */ }
  }

  private sendEofWhenAcknowledged(): void {
    if (!this.stopping || this.finished || this.eofSent || !this.bufferIntact() || (this.buffer?.pending() ?? 0) > 0) return;
    this.eofSent = true;
    try { this.socket.send(JSON.stringify({ type: 'eof' })); this.telemetry.eofUtc = new Date().toISOString(); }
    catch { this.fail('Son metin onayı alınamadı.'); }
  }

  private flushQueue(): void {
    if (!this.buffer || this.finished || !this.bufferIntact()) return;
    if (this.transportError || this.eofSent || (!this.ready && !this.stopping)) return;
    let sendFailed = false;
    this.buffer.drain((pending) => {
      if (!this.bufferIntact(false)) return false;
      if (this.socket.readyState !== 1 || this.socket.bufferedAmount > 128000) return false;
      try { this.socket.send(encodeGatewayLivePcm16Frame(pending)); this.sent(pending.chunkSeq); return true; }
      catch { sendFailed = true; return false; }
    });
    if (!this.bufferIntact()) return;
    if (sendFailed) { this.fail('Ses gönderimi başarısız oldu; teslim onayı alınamadı.'); return; }
    if (this.buffer.pending() && this.waitingSince !== undefined && Date.now() - this.waitingSince >= 10000) {
      this.fail('Ses teslimi 10 saniyedir ilerlemiyor. Bağlantı veya sunucu kabulü doğrulanamadı.'); return;
    }
    this.sendEofWhenAcknowledged();
  }

  private closed(code?: number): void {
    if (this.everReady) {
      this.continuityLost = true;
      this.recovery?.onConnectionInterrupted?.(this.connectionGeneration);
    }
    this.telemetry.closeCode = Number.isInteger(code) ? code! : 0;
    if (this.recovery && this.buffer && this.everReady && !this.stopping && (code === 1006 || code === undefined)) {
      this.ready = false; this.reconnecting = true; this.transportError = true;
      clearTimeout(this.timer); clearTimeout(this.errorTimer);
      // Offline native connections can fail immediately: three attempts lasted
      // only 3.5 seconds. Allow a bounded outage window instead of counting errors.
      // Ready without progress must not extend this window indefinitely.
      if (!this.recoveryTimer) this.recoveryTimer = setTimeout(() => this.fail(
        'Ses bağlantısı 60 saniye içinde yeniden kurulamadı veya bekleyen seslerin teslimi ilerlemedi. Kayıt eksik olarak durduruldu.',
      ), 60000);
      const generation = ++this.connectionGeneration;
      try { this.socket.close(); } catch { /* Invalidate old callbacks and continue bounded recovery. */ }
      const attempt = ++this.retries;
      this.recovery.onStatus(`Ses bağlantısı kesildi; ses geçici tamponda bekliyor. Yeniden bağlantı deneniyor (${attempt}); en fazla 60 saniye beklenecek.`);
      this.retryTimer = setTimeout(() => this.guard(() => {
        if (this.finished || this.stopping || generation !== this.connectionGeneration) return;
        this.timer = setTimeout(() => {
          if (!this.finished && !this.stopping && generation === this.connectionGeneration) this.guard(() => this.closed(1006));
        }, 15000);
        void this.recovery!.connect().then(socket => {
          if (this.finished || this.stopping || generation !== this.connectionGeneration) {
            try { socket.close(); } catch { /* The obsolete socket must never join the active stream. */ } return;
          }
          clearTimeout(this.timer);
          this.bind(socket);
        }).catch(() => {
          if (!this.finished && !this.stopping && generation === this.connectionGeneration) this.guard(() => this.closed(1006));
        });
      }), Math.min(500 * 2 ** Math.min(attempt - 1, 5), 10000));
      return;
    }
    const validCode = Number.isInteger(code) && code! >= 1000 && code! <= 4999;
    const stage = this.stopping ? 'Son metin onayı' : this.ready ? 'Ses aktarımı'
      : this.opened ? 'Ses sunucusunun hazır olması' : 'Ses bağlantısının açılması';
    const meaning = code === 1008 ? 'Sunucu bağlantıyı politika kontrolü nedeniyle reddetti. Hangi kontrol olduğu henüz doğrulanmadı.'
      : code === 1003 ? 'Sunucu bağlantı verisini veya oturum biçimini kabul etmedi. Kesin neden sunucu kaydından doğrulanmalı.'
        : code === 1011 ? 'Sunucu bağlantı sırasında iç hata bildirdi. Alt servis nedeni henüz doğrulanmadı.'
          : 'Bağlantı kapandı; ağ, istemci veya sunucu kaynaklı olduğu henüz doğrulanmadı.';
    this.fail(`Aşama: ${stage}\nWebSocket kodu: ${validCode ? code : 'iletilmedi'}\n${meaning}\nAksiyon: Tanılama kaydını sunucu kaydıyla eşleştirin.`);
  }

  private receive(raw: unknown): void {
    if (this.finished || typeof raw !== 'string') return;
    let event: Record<string, unknown>;
    try { event = JSON.parse(raw); } catch { return; }
    if (!event || typeof event !== 'object') return;
    if (!this.bufferIntact()) return;
    if (event.type === 'ready' && !this.ready && !this.stopping) {
      clearTimeout(this.timer);
      this.ready = true;
      this.reconnecting = false;
      this.transportError = false;
      this.buffer?.resetInFlight();
      this.waitingSince = this.buffer?.pending() ? Date.now() : undefined;
      if (!this.buffer?.pending()) {
        clearTimeout(this.recoveryTimer); this.recoveryTimer = undefined;
      }
      if (this.buffer && !this.flushTimer) this.flushTimer = setInterval(() => this.guard(() => this.flushQueue()), 250);
      if (this.everReady) {
        this.recovery?.onStatus('Ses bağlantısı yeniden kuruldu; bekleyen parçalar gönderiliyor.');
        this.flushQueue();
      } else { this.everReady = true; this.onReady(); }
    } else if (event.type === 'audio_ack' && this.buffer && Object.keys(event).length === 2 &&
      Number.isSafeInteger(event.chunk_seq) && (event.chunk_seq as number) >= 0) {
      const before = this.buffer.pending();
      this.buffer.acknowledge(event.chunk_seq as number);
      if (this.buffer.pending() < before) {
        this.telemetry.acknowledgedFrames++;
        this.telemetry.lastAckSeq = event.chunk_seq as number;
        this.telemetry.lastAckUtc = new Date().toISOString();
        clearTimeout(this.recoveryTimer); this.recoveryTimer = undefined;
        this.retries = 0;
        this.waitingSince = this.buffer.pending() ? Date.now() : undefined;
      }
      this.sendEofWhenAcknowledged();
    } else if (event.type === 'error') {
      this.fail('Ses sunucusu hata bildirdi. Test durduruldu.');
    } else if (event.type === 'drained' && this.stopping && this.eofSent) {
      this.telemetry.drainedUtc = new Date().toISOString();
      const resolve = this.stopResolve;
      this.stopResolve = undefined;
      this.dispose();
      resolve?.(true);
    } else if (Number.isSafeInteger(event.seq) && (event.seq as number) >= 0) {
      if (event.type === 'partial' && typeof event.confirmed === 'string' && typeof event.tentative === 'string') {
        this.telemetry.partialEvents++; this.telemetry.lastTextUtc = new Date().toISOString();
        this.onText({ connectionId: this.connectionGeneration, seq: event.seq as number, text: [event.confirmed, event.tentative].filter(Boolean).join(' '), final: false, confirmed: event.confirmed, tentative: event.tentative });
      } else if (event.type === 'final' && typeof event.text === 'string') {
        this.telemetry.finalEvents++; this.telemetry.lastTextUtc = new Date().toISOString();
        const speakerAttribution = readSpeakerAttribution(event.speakerAttribution, event.text, event.source_start_sample, event.source_end_sample);
        const validRange = Number.isSafeInteger(event.source_start_sample) && Number.isSafeInteger(event.source_end_sample) &&
          (event.source_start_sample as number) >= 0 && (event.source_end_sample as number) > (event.source_start_sample as number);
        this.onText({ connectionId: this.connectionGeneration, seq: event.seq as number, text: event.text, final: true,
          ...(validRange ? { sourceStartSample: event.source_start_sample as number, sourceEndSample: event.source_end_sample as number } : {}),
          ...(speakerAttribution ? { speakerAttribution } : {}) });
      }
    }
  }

  private sent(seq: number): void {
    this.telemetry.sentFrames++;
    this.telemetry.lastSentSeq = seq;
    this.telemetry.lastSendUtc = new Date().toISOString();
  }
}
