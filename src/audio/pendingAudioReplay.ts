import { ForegroundStream, type LiveSocket } from './foregroundStream';
import type { OfflineAudioBuffer } from './offlineBuffer';

export type PendingReplayResult = {
  state: 'gateway-drained' | 'failed' | 'cancelled';
  /** A fresh upstream connection cannot prove that older gateway-ACKed audio became text. */
  historyComplete: false;
};
const activeReplays = new WeakMap<OfflineAudioBuffer, LiveSocket>();

/**
 * One bounded replay attempt, without microphone capture, enqueue, lifecycle finish,
 * or journal completion. Callers may retry with a fresh authenticated socket after
 * a failed attempt. The same stored sequence, bytes and original TTL are preserved.
 */
export function replayPendingAudio(socket: LiveSocket, buffer: OfflineAudioBuffer) {
  const activeSocket = activeReplays.get(buffer);
  if (activeSocket) {
    if (socket !== activeSocket) { try { socket.close(); } catch { /* no second sender */ } }
    throw new Error('Bu ses tamponu için kurtarma zaten sürüyor.');
  }
  buffer.freezeCapture();
  activeReplays.set(buffer, socket);
  let settled = false;
  let stream: ForegroundStream | undefined;
  let resolve!: (result: PendingReplayResult) => void;
  const result = new Promise<PendingReplayResult>(done => { resolve = done; });
  const settle = (state: PendingReplayResult['state']) => {
    if (settled) return;
    settled = true;
    if (stream) stream.dispose();
    else { try { socket.close(); } catch { /* construction failed */ } }
    activeReplays.delete(buffer);
    resolve({ state, historyComplete: false });
  };
  try {
    stream = new ForegroundStream(socket,
      () => { void stream!.stop().then(drained => settle(drained ? 'gateway-drained' : 'failed')); },
      () => {}, // The gateway owns transcript persistence; this helper does not replace saved text.
      () => settle('failed'), buffer);
  } catch { settle('failed'); }
  return { result, cancel: () => settle('cancelled') };
}
