import {
  GATEWAY_LIVE_AUDIO_FRAME_HEADER_BYTES,
  encodeGatewayLivePcm16Frame,
  floatToPcm16Bytes,
  gatewayLiveStreamSessionUrl,
} from '../gatewayFrame';

describe('encodeGatewayLivePcm16Frame', () => {
  it('19-byte header: version + chunkSeq + capturedAtMs + payload-len (big-endian)', () => {
    const pcm16 = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const buf = encodeGatewayLivePcm16Frame({ chunkSeq: 7, capturedAtMs: 1000, pcm16 });
    const view = new DataView(buf);
    expect(buf.byteLength).toBe(GATEWAY_LIVE_AUDIO_FRAME_HEADER_BYTES + 4);
    expect(view.getUint8(0)).toBe(1); // version
    expect(view.getBigInt64(1, false)).toBe(7n); // chunkSeq BE
    expect(view.getBigInt64(9, false)).toBe(1000n); // capturedAtMs BE
    expect(view.getUint16(17, false)).toBe(4); // payload length BE
    expect(Array.from(new Uint8Array(buf, 19))).toEqual([1, 2, 3, 4]); // payload
  });

  it('boş / tek (odd) / çok büyük payload reddedilir', () => {
    expect(() => encodeGatewayLivePcm16Frame({ chunkSeq: 0, capturedAtMs: 0, pcm16: new Uint8Array(0) })).toThrow();
    expect(() => encodeGatewayLivePcm16Frame({ chunkSeq: 0, capturedAtMs: 0, pcm16: new Uint8Array(3) })).toThrow();
    expect(() =>
      encodeGatewayLivePcm16Frame({ chunkSeq: 0, capturedAtMs: 0, pcm16: new Uint8Array(70_000) }),
    ).toThrow();
  });

  it('negatif chunkSeq reddedilir', () => {
    expect(() =>
      encodeGatewayLivePcm16Frame({ chunkSeq: -1, capturedAtMs: 0, pcm16: new Uint8Array(2) }),
    ).toThrow();
  });
});

describe('floatToPcm16Bytes', () => {
  it('-1/0/1 -> -32768/0/32767 (little-endian)', () => {
    const bytes = floatToPcm16Bytes(new Float32Array([-1, 0, 1]));
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(-32768);
    expect(view.getInt16(2, true)).toBe(0);
    expect(view.getInt16(4, true)).toBe(32767);
  });
});

describe('gatewayLiveStreamSessionUrl', () => {
  it('https -> wss + doğru path', () => {
    expect(gatewayLiveStreamSessionUrl('https://gw.acik.com', 'SES-123')).toBe(
      'wss://gw.acik.com/api/v1/audio-gateway/sessions/SES-123/stream',
    );
  });

  it('localhost http -> ws', () => {
    expect(gatewayLiveStreamSessionUrl('http://localhost:8080', 'abc')).toBe(
      'ws://localhost:8080/api/v1/audio-gateway/sessions/abc/stream',
    );
  });

  it('credentials/query/geçersiz sessionId reddedilir', () => {
    expect(() => gatewayLiveStreamSessionUrl('https://u:p@gw.acik.com', 'x')).toThrow();
    expect(() => gatewayLiveStreamSessionUrl('https://gw.acik.com?a=1', 'x')).toThrow();
    expect(() => gatewayLiveStreamSessionUrl('https://gw.acik.com', 'boşluk var')).toThrow();
    expect(() => gatewayLiveStreamSessionUrl('http://prod.acik.com', 'x')).toThrow(); // non-local http yasak
  });
});
