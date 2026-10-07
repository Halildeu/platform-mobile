import { fetch as expoFetch } from 'expo/fetch';
import { AnalysisEvents, type AnalysisSnapshot } from './liveAnalysis';
import { SessionExpired } from '../auth/sessionManager';

/** Same gateway-fronted SSE path used by platform-desktop. */
export function subscribeAnalysis(options: {
  baseUrl: string; meetingId: string; getToken: () => Promise<string>;
  onSnapshot: (snapshot: AnalysisSnapshot) => void;
  onStatus: (status: string) => void;
  onDiagnostic?: (message: string) => void;
}): () => void {
  if (!/^https:\/\/[^/]+$/.test(options.baseUrl) || !/^[0-9a-f-]{36}$/i.test(options.meetingId)) throw new Error('Geçersiz analiz adresi.');
  let stopped = false;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let connections = 0;
  let reportCurrent: (() => void) | undefined;
  async function connect() {
    if (stopped) return;
    const connectionNumber = ++connections;
    const parser = new AnalysisEvents();
    let bytes = 0;
    let lastReportedAt = Date.now();
    const report = () => {
      const counts = parser.diagnostics();
      options.onDiagnostic?.(`Canlı analiz akışı: bağlantı=${connectionNumber}, bayt=${bytes}, heartbeat=${counts.heartbeats}, geçerli=${counts.accepted}, bozuk JSON=${counts.invalidJson}, sözleşmeye uymayan=${counts.rejected}, bilinmeyen olay=${counts.unknownEvents}, sınır aşımı=${counts.overflows}`);
      lastReportedAt = Date.now();
    };
    reportCurrent = report;
    controller = new AbortController();
    const connection = controller;
    let cause = 'Canlı analiz bağlantısı kesildi';
    const armTimeout = (milliseconds: number, message: string) => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => { cause = message; connection.abort(); }, milliseconds);
    };
    armTimeout(15000, 'Canlı analiz sunucusu 15 saniyede yanıt vermedi');
    options.onStatus('Canlı analiz bağlanıyor…');
    try {
      const token = await options.getToken();
      // A refresh may finish after stop, logout, or the handshake deadline.
      if (stopped) return;
      if (connection.signal.aborted) throw new Error('Analiz bağlantısı zaman aşımı.');
      const response = await expoFetch(`${options.baseUrl}/api/v1/audio-gateway/meetings/${encodeURIComponent(options.meetingId)}/live-analysis/stream`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: connection.signal, redirect: 'error',
      });
      if (stopped) { await response.body?.cancel(); return; }
      if (!response.ok || !response.body) {
        clearTimeout(watchdog);
        await response.body?.cancel().catch(() => {});
        options.onStatus(`Canlı analiz alınamadı (${response.status}).`);
        if ([400, 401, 403, 404].includes(response.status)) return;
        cause = `Canlı analiz sunucusu HTTP ${response.status} döndürdü`;
        throw new Error('Analiz bağlantısı açılamadı.');
      }
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
        clearTimeout(watchdog);
        await response.body.cancel().catch(() => {});
        options.onStatus('Canlı analiz yanıtı beklenen akış biçiminde değil. Sunucu yönlendirmesi kontrol edilmeli.');
        return;
      }
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      options.onStatus('Canlı analiz bağlı; ilk sonuç bekleniyor.');
      try {
        while (!stopped) {
          armTimeout(45000, 'Canlı analiz akışından 45 saniyedir veri veya bağlantı sinyali gelmedi');
          const result = await reader.read(); if (result.done) break;
          if (stopped) break;
          bytes += result.value.byteLength;
          const before = parser.diagnostics();
          for (const snapshot of parser.push(decoder.decode(result.value, { stream: true }))) {
            attempts = 0;
            options.onSnapshot(snapshot);
          }
          const after = parser.diagnostics();
          if ((after.invalidJson + after.rejected + after.unknownEvents) >
              (before.invalidJson + before.rejected + before.unknownEvents)) {
            options.onStatus('Canlı analiz bağlantısında beklenen biçime uymayan veri alındı. Tanılama kaydına işlendi.');
          }
          if (Date.now() - lastReportedAt >= 15000) report();
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch (error) {
      if (!stopped && error instanceof SessionExpired) {
        options.onStatus('Canlı analiz için oturum sona erdi. Yeniden giriş yapın.');
        return;
      }
      // Show only the known stage/status, never a raw server payload.
    } finally { clearTimeout(watchdog); if (!stopped) report(); }
    if (!stopped && ++attempts <= 5) {
      options.onStatus(`${cause}; yeniden bağlanıyor (${attempts}/5).`);
      timer = setTimeout(() => void connect(), Math.min(500 * 2 ** attempts, 10000));
    }
    else if (!stopped) options.onStatus(`${cause}. Beş yeniden bağlantı denemesi başarısız oldu.`);
  }
  void connect();
  return () => {
    if (stopped) return;
    stopped = true;
    // Capture final counters synchronously, before the screen invalidates this
    // recording generation; an asynchronous finally could belong to a new run.
    reportCurrent?.();
    clearTimeout(timer); clearTimeout(watchdog); controller?.abort();
  };
}
