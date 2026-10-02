import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { AudioBufferJournal } from './audioBufferJournal';

export const BUFFER_JOURNAL_KEY = 'platform-mobile.audio-buffer-journal.v1';
export const bufferJournal = new AudioBufferJournal({
  read: () => SecureStore.getItemAsync(BUFFER_JOURNAL_KEY),
  write: value => SecureStore.setItemAsync(BUFFER_JOURNAL_KEY, value,
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
}, value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value));

/** No SQLite import/open when there is no persisted metadata. Never auto-starts capture. */
let sweeping: Promise<void> | undefined;
async function sweep(): Promise<void> {
  if (!(await bufferJournal.list()).length) return;
  const { sweepEncryptedChunkBuffers } = await import('./encryptedChunkBuffer');
  await sweepEncryptedChunkBuffers();
}
export function sweepAudioBuffers(): Promise<void> {
  sweeping ??= sweep().finally(() => { sweeping = undefined; });
  return sweeping;
}
