import type { WsStreamEvent } from '../../contracts/wsStreamEvents';
import {
  GatewayClient,
  nextBackoffMs,
  type GatewaySocket,
} from '../gatewayClient';

class FakeSocket implements GatewaySocket {
  sent: ArrayBuffer[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error?: unknown) => void) | null = null;
  send(data: ArrayBuffer): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
}

function partialJson(seq: number): string {
  return JSON.stringify({
    type: 'partial',
    seq,
    confirmed: 'metin',
    tentative: '',
    elapsed_ms: 5,
    rms: 0.1,
    source: 'gateway',
  });
}

describe('nextBackoffMs', () => {
  it('üstel + tavan', () => {
    expect(nextBackoffMs(1, 500, 10_000)).toBe(500);
    expect(nextBackoffMs(2, 500, 10_000)).toBe(1000);
    expect(nextBackoffMs(3, 500, 10_000)).toBe(2000);
    expect(nextBackoffMs(10, 500, 10_000)).toBe(10_000); // tavan
    expect(nextBackoffMs(0)).toBe(0);
  });
});

describe('GatewayClient', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function make() {
    const sockets: FakeSocket[] = [];
    const events: WsStreamEvent[] = [];
    const statuses: string[] = [];
    const client = new GatewayClient({
      url: 'wss://gw/x',
      socketFactory: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      onEvent: (e) => events.push(e),
      onStatus: (s) => statuses.push(s),
      baseBackoffMs: 500,
      maxBackoffMs: 10_000,
    });
    return { sockets, events, statuses, client };
  }

  it('connect -> connecting -> open', () => {
    const { sockets, statuses, client } = make();
    client.connect();
    expect(statuses).toContain('connecting');
    sockets[0].onopen?.();
    expect(statuses).toContain('open');
  });

  it('gelen JSON olay parse edilip onEvent ile verilir; geçersiz yutulur', () => {
    const { sockets, events, client } = make();
    client.connect();
    sockets[0].onmessage?.({ data: partialJson(3) });
    sockets[0].onmessage?.({ data: '{bozuk json' });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'unknown' }) });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'partial', seq: 3 });
  });

  it('sendPcm16 socket açıkken frame gönderir, kapalıyken false', () => {
    const { sockets, client } = make();
    expect(client.sendPcm16(0, 0, new Uint8Array([1, 2]))).toBe(false); // henüz connect yok
    client.connect();
    expect(client.isOpen).toBe(false);
    expect(client.sendPcm16(0, 1000, new Uint8Array([1, 2]))).toBe(false);
    expect(sockets[0].sent).toHaveLength(0);
    sockets[0].onopen?.();
    expect(client.isOpen).toBe(true);
    expect(client.sendPcm16(0, 1000, new Uint8Array([1, 2]))).toBe(true);
    expect(sockets[0].sent).toHaveLength(1);
    expect(sockets[0].sent[0].byteLength).toBe(19 + 2);
  });

  it('bağlantı düşünce backoff ile yeniden bağlanır', () => {
    const { sockets, statuses, client } = make();
    client.connect();
    sockets[0].onopen?.();
    sockets[0].onclose?.(); // düştü
    expect(client.isOpen).toBe(false);
    expect(client.sendPcm16(1, 1000, new Uint8Array([1, 2]))).toBe(false);
    expect(statuses).toContain('reconnecting');
    expect(sockets).toHaveLength(1);
    jest.advanceTimersByTime(500); // ilk backoff
    expect(sockets).toHaveLength(2); // yeni socket açıldı
    expect(client.isOpen).toBe(false);
    sockets[1].onopen?.();
    expect(client.isOpen).toBe(true);
  });

  it('tekrarlanan connect ikinci bağlantı veya yeniden bağlanma oluşturmaz', () => {
    const { sockets, client } = make();
    client.connect();
    client.connect();
    expect(sockets).toHaveLength(1);
    sockets[0].onclose?.();
    client.connect();
    expect(sockets).toHaveLength(1);
    jest.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
  });

  it('eski bağlantının geciken olayları yeni bağlantıyı etkilemez', () => {
    const { sockets, events, client } = make();
    client.connect();
    client.close();
    client.connect();
    sockets[0].onopen?.();
    expect(client.isOpen).toBe(false);
    sockets[1].onopen?.();
    sockets[0].onclose?.();
    sockets[0].onmessage?.({ data: partialJson(9) });
    expect(client.isOpen).toBe(true);
    expect(events).toHaveLength(0);
    jest.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
  });

  it('bekleyen yeniden bağlantı close ile iptal edilir', () => {
    const { sockets, client } = make();
    client.connect();
    sockets[0].onclose?.();
    client.close();
    jest.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(client.isOpen).toBe(false);
    expect(client.sendPcm16(0, 0, new Uint8Array([1, 2]))).toBe(false);
  });

  it('close() sonrası yeniden bağlanmaz', () => {
    const { sockets, client } = make();
    client.connect();
    sockets[0].onopen?.();
    client.close();
    sockets[0].onclose?.(); // kapanış olayı gelse bile
    jest.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1); // yeni socket YOK
  });
});
