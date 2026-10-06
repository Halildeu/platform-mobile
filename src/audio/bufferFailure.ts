const descriptions = {
  AUDIO_CAPACITY: 'Bu cihazda kapanışı bekleyen ses kayıtları sınırına ulaşıldı. Önceki kayıtların kapanışı çözülmeden yeni kayıt açılamaz. Kayıtlar korunuyor.',
  AUDIO_JOURNAL: 'Ses kayıt dizinine erişilemedi.',
  AUDIO_FILES: 'Ses dosyalarının durumu doğrulanamadı.',
  AUDIO_KEY_READ: 'Ses deposunun anahtarı okunamadı.',
  AUDIO_KEY_WRITE: 'Yeni ses deposunun anahtarı saklanamadı.',
  AUDIO_DATABASE: 'Ses veritabanı açılamadı.',
  AUDIO_CIPHER: 'Şifreli ses depolama desteği doğrulanamadı.',
  AUDIO_UNLOCK: 'Ses veritabanının şifresi açılamadı.',
  AUDIO_SCHEMA: 'Ses kayıt tabloları hazırlanamadı.',
  AUDIO_READY: 'Ses deposunun hazır olduğu kaydedilemedi.',
  AUDIO_RECOVERY: 'Önceki ses deposu kurtarma için doğrulanamadı.',
} as const;
export type BufferFailureCode = keyof typeof descriptions;
/** Fixed, non-sensitive codes only: never include native SQL, paths or keys. */
export class BufferStorageError extends Error {
  constructor(readonly code: BufferFailureCode) {
    super(`Şifreli ses deposu işlemi doğrulanamadı. ${descriptions[code]} İnceleme kodu: ${code}.`);
  }
}
