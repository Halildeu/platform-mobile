import { fetch as expoFetch } from 'expo/fetch';
import { AnalysisEvents, type AnalysisSnapshot } from './liveAnalysis';

/** Same gateway-fronted SSE path used by platform-desktop. */
export function subscribeAnalysis(options: {
  baseUrl: string; meetingId: string; token: string;
  onSnapshot: (snapshot: AnalysisSnapshot) => void;
  onStatus: (status: string) => void;
}): () => void {
  if (!/^https:\/\/[^/]+$/.test(options.baseUrl) || !/^[0-9a-f-]{36}$/i.test(options.meetingId)) throw new Error('Geçersiz analiz adresi.');
  let stopped = false;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  async function connect() {
    if (stopped) return;
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
      const response = await expoFetch(`${options.baseUrl}/api/v1/audio-gateway/meetings/${encodeURIComponent(options.meetingId)}/live-analysis/stream`, {
        headers: { Authorization: `Bearer ${options.token}`, Accept: 'text/event-stream' }, signal: connection.signal, redirect: 'error',
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
      const reader = response.body.getReader(); const decoder = new TextDecoder(); const parser = new AnalysisEvents();
      options.onStatus('Canlı analiz bağlı; ilk sonuç bekleniyor.');
      try {
        while (!stopped) {
          armTimeout(45000, 'Canlı analiz akışından 45 saniyedir veri veya bağlantı sinyali gelmedi');
          const result = await reader.read(); if (result.done) break;
          if (stopped) break;
          for (const snapshot of parser.push(decoder.decode(result.value, { stream: true }))) {
            attempts = 0;
            options.onSnapshot(snapshot);
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } catch {
      // Show only the known stage/status, never a raw server payload.
    } finally { clearTimeout(watchdog); }
    if (!stopped && ++attempts <= 5) {
      options.onStatus(`${cause}; yeniden bağlanıyor (${attempts}/5).`);
      timer = setTimeout(() => void connect(), Math.min(500 * 2 ** attempts, 10000));
    }
    else if (!stopped) options.onStatus(`${cause}. Beş yeniden bağlantı denemesi başarısız oldu.`);
  }
  void connect();
  return () => { stopped = true; clearTimeout(timer); clearTimeout(watchdog); controller?.abort(); };
}
