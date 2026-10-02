const descriptions = {
  HISTORY_IDENTITY: 'Tanılamanın bağlı olduğu hesap doğrulanamadı.',
  HISTORY_DIRECTORY: 'Tanılama klasörüne erişilemedi.',
  HISTORY_CAPACITY: 'Bu cihazda tanılama hesap sınırına ulaşıldı.',
  HISTORY_KEY_READ: 'Şifreleme anahtarı cihazdan okunamadı.',
  HISTORY_KEY_MISSING: 'Önceki tanılama deposunun anahtarı bulunamadı; mevcut kayıtlar korunuyor.',
  HISTORY_KEY_WRITE: 'Şifreleme anahtarı cihazda saklanamadı.',
  HISTORY_KEY_INVALID: 'Tanılama şifreleme anahtarı doğrulanamadı.',
  HISTORY_DATABASE_OPEN: 'Tanılama veritabanı açılamadı.',
  HISTORY_CIPHER: 'Bu pakette şifreli tanılama desteği doğrulanamadı.',
  HISTORY_UNLOCK: 'Tanılama veritabanının şifresi açılamadı.',
  HISTORY_SCHEMA: 'Tanılama kayıt tabloları hazırlanamadı.',
  HISTORY_MODULE: 'Tanılama bileşeni yüklenemedi.',
  HISTORY_UNKNOWN: 'Tanılama açılışı tamamlanamadı.',
} as const;
export type DiagnosticFailureCode = keyof typeof descriptions;
export class DiagnosticOpenError extends Error {
  constructor(readonly code: DiagnosticFailureCode) { super(descriptions[code]); }
}
/** No native exception message, path, database key or token is displayed/exported. */
export function diagnosticFailureCode(error: unknown): DiagnosticFailureCode {
  return error instanceof DiagnosticOpenError && Object.hasOwn(descriptions, error.code) ? error.code : 'HISTORY_UNKNOWN';
}
export function diagnosticFailureDescription(code: DiagnosticFailureCode) { return descriptions[code]; }
