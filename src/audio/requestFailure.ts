export function requestFailure(stage: string, status: number, payload: unknown): string {
  const details = payload && typeof payload === 'object'
    ? payload as Record<string, unknown> : {};
  const code = typeof details.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(details.code)
    ? ` Kod: ${details.code}.` : '';
  const correlation = typeof details.correlationId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(details.correlationId)
    ? ` Takip: ${details.correlationId}.` : '';
  const reason = status === 403
    ? 'Sunucu bu işlem için yetki vermedi; bu mesaj şifre hatası değildir.'
    : status === 401 ? 'Giriş oturumu kabul edilmedi veya süresi doldu.'
      : 'Sunucu isteği tamamlanamadı.';
  return `${stage} (${status}): ${reason}${code}${correlation}`;
}
