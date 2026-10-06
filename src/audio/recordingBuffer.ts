import { OfflineAudioBuffer } from './offlineBuffer';
import { BufferStorageError } from './bufferFailure';
import { bufferJournal } from './nativeBufferJournal';

/** Check local admission before creating another remote recording/session. Never discards entries. */
export async function prepareRecordingStorage(retentionMs: unknown): Promise<void> {
  if (retentionMs === undefined || retentionMs === null) return;
  if (typeof retentionMs !== 'number' || !Number.isSafeInteger(retentionMs) || retentionMs <= 0) {
    throw new Error('Ses saklama süresi geçersiz; kayıt başlatılmadı.');
  }
  try {
    await bufferJournal.assertCapacity();
  } catch (error) {
    throw error instanceof BufferStorageError ? error : new BufferStorageError('AUDIO_JOURNAL');
  }
}

type DurableHandle = {
  buffer: OfflineAudioBuffer;
  close: () => void;
  destroy: () => Promise<void>;
  confirmDrained: () => Promise<void>;
  markLost: () => Promise<void>;
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

/** No native database is opened when retention has not been configured. */
export async function createRecordingBuffer(options: Options, open?: Open) {
  const limits = { maxBytes: 2 * 1024 * 1024, maxChunks: 2000 };
  if (options.retentionMs === undefined || options.retentionMs === null) {
    const buffer = new OfflineAudioBuffer(limits);
    return { mode: 'memory' as const, buffer,
      confirmDrained: async () => {},
      release: async () => { buffer.clear(); return 'memory' as const; } };
  }
  if (typeof options.retentionMs !== 'number' || !Number.isSafeInteger(options.retentionMs) || options.retentionMs <= 0) {
    throw new Error('Ses saklama süresi geçersiz; kayıt başlatılmadı.');
  }
  const ownerScope = await options.ownerScope();
  const opener = open ?? (await import('./encryptedChunkBuffer')).openEncryptedChunkBuffer;
  const handle = await opener({ ...limits, ownerScope, sessionId: options.sessionId,
    retentionMs: options.retentionMs, onStorageError: options.onStorageError });
  let releaseAction: 'retained' | 'removed' | 'lost' | undefined;
  let released: 'retained' | 'removed' | 'lost' | undefined;
  let drained = false;
  let lossMarked = false;
  return { mode: 'encrypted' as const, buffer: handle.buffer,
    confirmDrained: async () => { await handle.confirmDrained(); drained = true; },
    release: async () => {
    if (released) return released;
    // Transport success alone is not an acknowledgement. Never delete pending audio here.
    // Cleanup can close storage before failing; retries must not read that closed store.
    releaseAction ??= handle.buffer.purged() || handle.buffer.dropped() ? 'lost'
      : drained && handle.buffer.pending() === 0 ? 'removed' : 'retained';
    if (releaseAction === 'retained') {
      handle.close();
      released = 'retained';
    } else {
      if (releaseAction === 'lost' && !lossMarked) { await handle.markLost(); lossMarked = true; }
      await handle.destroy();
      released = releaseAction;
    }
    return released;
  } };
}
