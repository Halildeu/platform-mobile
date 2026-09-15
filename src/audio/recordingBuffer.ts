import { OfflineAudioBuffer } from './offlineBuffer';

type DurableHandle = {
  buffer: OfflineAudioBuffer;
  close: () => void;
  destroy: () => Promise<void>;
};
type Options = {
  retentionMs: unknown;
  sessionId: string;
  ownerScope: () => Promise<string>;
  onStorageError: () => void;
};
type Open = (options: {
  ownerScope: string; sessionId: string; retentionMs: number;
  maxBytes: number; maxChunks: number; onStorageError: () => void;
}) => Promise<DurableHandle>;

/** No native storage is loaded when retention has not been configured. */
export async function createRecordingBuffer(options: Options, open?: Open) {
  const limits = { maxBytes: 2 * 1024 * 1024, maxChunks: 2000 };
  if (options.retentionMs === undefined || options.retentionMs === null) {
    return { mode: 'memory' as const, buffer: new OfflineAudioBuffer(limits),
      release: async () => 'memory' as const };
  }
  if (typeof options.retentionMs !== 'number' || !Number.isSafeInteger(options.retentionMs) || options.retentionMs <= 0) {
    throw new Error('Ses saklama süresi geçersiz; kayıt başlatılmadı.');
  }
  const ownerScope = await options.ownerScope();
  const opener = open ?? (await import('./encryptedChunkBuffer')).openEncryptedChunkBuffer;
  const handle = await opener({ ...limits, ownerScope, sessionId: options.sessionId,
    retentionMs: options.retentionMs, onStorageError: options.onStorageError });
  let releaseAction: 'retained' | 'removed' | undefined;
  let released: 'retained' | 'removed' | undefined;
  return { mode: 'encrypted' as const, buffer: handle.buffer, release: async () => {
    if (released) return released;
    // Transport success alone is not an acknowledgement. Never delete pending audio here.
    // Cleanup can close storage before failing; retries must not read that closed store.
    releaseAction ??= handle.buffer.pending() > 0 ? 'retained' : 'removed';
    if (releaseAction === 'retained') {
      handle.close();
      released = 'retained';
    } else {
      await handle.destroy();
      released = 'removed';
    }
    return released;
  } };
}
