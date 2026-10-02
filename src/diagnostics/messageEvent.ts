import type { DiagnosticKind, Details } from './history';

/** Extract metadata from our existing status messages; NEVER persist the message itself. */
export function messageEvent(message: string): { kind: DiagnosticKind; details: Details } | undefined {
  if (message.startsWith('Kalıcı sonuç okuma isteği başlatıldı;')) return { kind: 'saved_requested', details: {} };
  if (message === 'Kalıcı sonuç alındı ve toplantı eşleşmesi doğrulandı') return { kind: 'saved_received', details: {} };
  const status = /^Kalıcı toplantı sonucu \((\d{3})\):/.exec(message);
  if (status) return { kind: 'request_failed', details: { status: Number(status[1]), requestId: /Takip: ([\da-f-]{36})\./i.exec(message)?.[1] } };
  if (message.startsWith('Ses akışı kapanış sonucu:')) return { kind: 'drained', details: { success: message.endsWith('drained doğrulandı') } };
  if (message === 'HTTP kayıt kapanışı başlatıldı') return { kind: 'http_finish_started', details: {} };
  if (message === 'HTTP kayıt kapanışı: FINISHED yanıtı doğrulandı') return { kind: 'http_finished', details: {} };
  if (message.startsWith('Analiz aboneliği istemci tarafından kapatılıyor.')) return { kind: 'analysis_closed', details: {} };
  if (message.startsWith('Canlı analiz akışı:')) {
    const details: Details = {};
    for (const [source, key] of [['bağlantı', 'connection'], ['bayt', 'bytes'], ['heartbeat', 'heartbeat'], ['geçerli', 'valid'], ['bozuk JSON', 'invalidJson'], ['sözleşmeye uymayan', 'rejected'], ['bilinmeyen olay', 'unknownEvents'], ['sınır aşımı', 'overflows']]) {
      const value = new RegExp(`(?:[: ,;]|^)${source}=(\\d+)`).exec(message)?.[1];
      if (value) details[key] = Number(value);
    }
    return { kind: 'analysis_stream', details };
  }
  return undefined;
}
