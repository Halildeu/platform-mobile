/**
 * Gateway live-audio wire format (PR-mobile-02, #4).
 *
 * BYTE-FOR-BYTE mirror of the proven desktop client
 * (platform-desktop/src/audio/gateway-live-stream.ts) so the same
 * audio-gateway-service accepts mobile frames unchanged.
 *
 * Frame (19-byte header, network/big-endian; PCM16 little-endian payload):
 *   [0]      uint8   version (=1)
 *   [1..8]   int64   chunkSeq        (BE)
 *   [9..16]  int64   capturedAtMs    (BE)
 *   [17..18] uint16  payload length  (BE)
 *   [19..]   bytes   PCM16 LE (even length, 1..65535)
 */
export const GATEWAY_LIVE_AUDIO_FRAME_VERSION = 1;
export const GATEWAY_LIVE_AUDIO_FRAME_HEADER_BYTES = 19;
export const GATEWAY_LIVE_AUDIO_FRAME_MAX_PAYLOAD_BYTES = 65_535;

const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export interface GatewayLivePcm16FrameInput {
  chunkSeq: number;
  capturedAtMs: number;
  pcm16: Uint8Array;
}

function requireNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

export function encodeGatewayLivePcm16Frame(
  input: GatewayLivePcm16FrameInput,
): ArrayBuffer {
  requireNonNegativeSafeInteger(input.chunkSeq, 'chunkSeq');
  requireNonNegativeSafeInteger(input.capturedAtMs, 'capturedAtMs');

  const pcm16 = input.pcm16;
  if (
    pcm16.byteLength === 0 ||
    pcm16.byteLength > GATEWAY_LIVE_AUDIO_FRAME_MAX_PAYLOAD_BYTES
  ) {
    throw new Error('PCM16 payload length must be between 1 and 65535 bytes');
  }
  if ((pcm16.byteLength & 1) !== 0) {
    throw new Error('PCM16 payload length must be even');
  }

  const encoded = new ArrayBuffer(
    GATEWAY_LIVE_AUDIO_FRAME_HEADER_BYTES + pcm16.byteLength,
  );
  const view = new DataView(encoded);
  view.setUint8(0, GATEWAY_LIVE_AUDIO_FRAME_VERSION);
  view.setBigInt64(1, BigInt(input.chunkSeq), false);
  view.setBigInt64(9, BigInt(input.capturedAtMs), false);
  view.setUint16(17, pcm16.byteLength, false);
  new Uint8Array(encoded, GATEWAY_LIVE_AUDIO_FRAME_HEADER_BYTES).set(pcm16);
  return encoded;
}

/** Convert normalized float samples (-1..1) to signed little-endian PCM16 bytes. */
export function floatToPcm16Bytes(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const s = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(i * 2, Math.round(s), true); // little-endian
  }
  return out;
}

function isLocalHttp(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1')
  );
}

/**
 * Build the gateway session URL without embedding credentials — the JWT is
 * attached during the WebSocket handshake, never in the URL.
 */
export function gatewayLiveStreamSessionUrl(
  gatewayBaseUrl: string,
  sessionId: string,
): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('sessionId must match the gateway identifier contract');
  }
  let url: URL;
  try {
    url = new URL(gatewayBaseUrl);
  } catch {
    throw new Error('gatewayBaseUrl must be an absolute URL');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('gatewayBaseUrl must not contain credentials, query, or fragment');
  }
  if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  } else if (isLocalHttp(url)) {
    url.protocol = 'ws:';
  } else {
    throw new Error('gatewayBaseUrl must use HTTPS, except local development URLs');
  }
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}/api/v1/audio-gateway/sessions/${sessionId}/stream`;
  return url.toString();
}
