import { encodeGatewayLivePcm16Frame } from './gatewayFrame';
import { OfflineAudioBuffer } from './offlineBuffer';

export interface LiveText { seq: number; text: string; final: boolean; confirmed?: string; tentative?: string }
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

/** Foreground PoC: fail closed on disconnect; no offline delivery guarantee. */
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
  private reconnecting = false;
  private everReady = false;
  private connectionGeneration = 0;
  private retries = 0;

  constructor(
    private socket: LiveSocket,
    private readonly onReady: () => void,
    private readonly onText: (text: LiveText) => void,
    private readonly onFailure: (message: string) => void,
    private readonly buffer?: OfflineAudioBuffer,
    private readonly recovery?: { connect(): Promise<LiveSocket>; onStatus(message: string): void },
  ) {
    this.bind(socket);
  }

  private bind(socket: LiveSocket): void {
    this.socket = socket;
    const generation = ++this.connectionGeneration;
    this.opened = false;
    this.transportError = false;
    this.errorTimer = undefined;
    this.timer = setTimeout(() => this.reconnecting ? this.closed(1006) : this.fail('Ses sunucusu hazır olmadı.'), 15000);
    socket.onmessage = (event) => { if (generation === this.connectionGeneration) this.receive(event.data); };
    socket.onopen = () => { if (generation === this.connectionGeneration) this.opened = true; };
    socket.onerror = () => {
      if (generation !== this.connectionGeneration || this.finished) return;
      // Native transports often emit close with a useful code immediately after error.
      this.transportError = true;
      if (!this.errorTimer) this.errorTimer = setTimeout(() => this.closed(), 500);
    };
    socket.onclose = (event) => {
      if (!this.finished && generation === this.connectionGeneration) this.closed(event?.code);
    };
  }

  send(data: ArrayBuffer, sampleRate: number, channels: number, capturedAtMs: number): boolean {
    const recovering = !!this.recovery && !!this.buffer && this.everReady && (this.reconnecting || this.transportError);
    if ((!this.ready && !recovering) || this.stopping || this.finished || (this.transportError && !recovering)) return false;
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
          const lost = this.buffer.dropped() + this.buffer.purged();
          this.buffer.enqueue(chunk);
          if (lost !== this.buffer.dropped() + this.buffer.purged()) {
            this.fail('Ses tamponu sınırına ulaşıldı; kayıp oluştuğu için test durduruldu.'); return false;
          }
          if (this.waitingSince === undefined) this.waitingSince = Date.now();
          this.flushQueue();
          if (this.finished) return false;
        } else this.socket.send(encodeGatewayLivePcm16Frame(chunk));
      }
      return true;
    } catch {
      this.fail('Ses gönderilemedi. Test durduruldu.');
      return false;
    }
  }

  stop(): Promise<boolean> {
    if (this.finished || this.stopping) return Promise.resolve(false);
    this.stopping = true;
    clearTimeout(this.retryTimer);
    if (this.reconnecting) ++this.connectionGeneration;
    this.ready = false;
    clearTimeout(this.timer);
    clearTimeout(this.errorTimer);
    return new Promise((resolve) => {
      this.stopResolve = resolve;
      this.timer = setTimeout(() => this.fail('Son metin onayı alınamadı.'), 12000);
      this.sendEofWhenAcknowledged();
    });
  }

  dispose(): void {
    this.finished = true;
    ++this.connectionGeneration;
    clearTimeout(this.retryTimer);
    this.ready = false;
    clearTimeout(this.timer);
    clearTimeout(this.errorTimer);
    clearInterval(this.flushTimer);
    this.stopResolve?.(false);
    this.stopResolve = undefined;
    this.socket.close();
  }

  private fail(message: string): void {
    if (this.finished) return;
    const pending = this.buffer?.pending() ?? 0;
    this.dispose();
    this.onFailure(pending ? `${message}\nGateway teslim onayı bekleyen ses parçası: ${pending}. Eksiksiz teslim doğrulanmadı.` : message);
  }

  private sendEofWhenAcknowledged(): void {
    if (!this.stopping || this.finished || this.eofSent || (this.buffer?.pending() ?? 0) > 0) return;
    this.eofSent = true;
    try { this.socket.send(JSON.stringify({ type: 'eof' })); }
    catch { this.fail('Son metin onayı alınamadı.'); }
  }

  private flushQueue(): void {
    if (!this.buffer || this.finished || this.transportError || this.eofSent || (!this.ready && !this.stopping)) return;
    if (this.buffer.purgeExpired() > 0) {
      this.fail('Ses saklama süresi doldu; eksiksiz teslim doğrulanamadı.'); return;
    }
    let sendFailed = false;
    this.buffer.drain((pending) => {
      if (this.socket.readyState !== 1 || this.socket.bufferedAmount > 128000) return false;
      try { this.socket.send(encodeGatewayLivePcm16Frame(pending)); return true; }
      catch { sendFailed = true; return false; }
    });
    if (sendFailed) { this.fail('Ses gönderimi başarısız oldu; teslim onayı alınamadı.'); return; }
    if (this.buffer.pending() && this.waitingSince !== undefined && Date.now() - this.waitingSince >= 10000) {
      this.fail('Ses teslimi 10 saniyedir ilerlemiyor. Bağlantı veya sunucu kabulü doğrulanamadı.'); return;
    }
    this.sendEofWhenAcknowledged();
  }

  private closed(code?: number): void {
    if (this.recovery && this.buffer && this.everReady && !this.stopping && (code === 1006 || code === undefined) && this.retries < 3) {
      this.ready = false; this.reconnecting = true; this.transportError = true;
      clearTimeout(this.timer); clearTimeout(this.errorTimer); clearInterval(this.flushTimer);
      const generation = ++this.connectionGeneration;
      this.socket.close();
      const attempt = ++this.retries;
      this.recovery.onStatus(`Ses bağlantısı kesildi; ses geçici tamponda bekliyor. Yeniden bağlantı ${attempt}/3.`);
      this.retryTimer = setTimeout(() => {
        if (this.finished || this.stopping || generation !== this.connectionGeneration) return;
        this.timer = setTimeout(() => {
          if (!this.finished && !this.stopping && generation === this.connectionGeneration) this.closed(1006);
        }, 15000);
        void this.recovery!.connect().then(socket => {
          if (this.finished || this.stopping || generation !== this.connectionGeneration) { socket.close(); return; }
          clearTimeout(this.timer);
          this.bind(socket);
        }).catch(() => {
          if (!this.finished && !this.stopping && generation === this.connectionGeneration) this.closed(1006);
        });
      }, 500 * 2 ** (attempt - 1));
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
    if (event.type === 'ready' && !this.ready && !this.stopping) {
      clearTimeout(this.timer);
      this.ready = true;
      this.reconnecting = false;
      this.transportError = false;
      this.buffer?.resetInFlight();
      this.waitingSince = this.buffer?.pending() ? Date.now() : undefined;
      if (this.buffer) this.flushTimer = setInterval(() => this.flushQueue(), 250);
      if (this.everReady) {
        this.recovery?.onStatus('Ses bağlantısı yeniden kuruldu; bekleyen parçalar gönderiliyor.');
        this.flushQueue();
      } else { this.everReady = true; this.onReady(); }
    } else if (event.type === 'audio_ack' && this.buffer && Object.keys(event).length === 2 &&
      Number.isSafeInteger(event.chunk_seq) && (event.chunk_seq as number) >= 0) {
      const before = this.buffer.pending();
      this.buffer.acknowledge(event.chunk_seq as number);
      if (this.buffer.pending() < before) {
        this.retries = 0;
        this.waitingSince = this.buffer.pending() ? Date.now() : undefined;
      }
      this.sendEofWhenAcknowledged();
    } else if (event.type === 'error') {
      this.fail('Ses sunucusu hata bildirdi. Test durduruldu.');
    } else if (event.type === 'drained' && this.stopping && this.eofSent) {
      const resolve = this.stopResolve;
      this.stopResolve = undefined;
      this.dispose();
      resolve?.(true);
    } else if (Number.isSafeInteger(event.seq) && (event.seq as number) >= 0) {
      if (event.type === 'partial' && typeof event.confirmed === 'string' && typeof event.tentative === 'string') {
        this.onText({ seq: event.seq as number, text: [event.confirmed, event.tentative].filter(Boolean).join(' '), final: false, confirmed: event.confirmed, tentative: event.tentative });
      } else if (event.type === 'final' && typeof event.text === 'string') {
        this.onText({ seq: event.seq as number, text: event.text, final: true });
      }
    }
  }
}
