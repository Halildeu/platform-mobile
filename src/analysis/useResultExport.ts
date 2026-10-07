import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { mobileSession } from '../auth/mobileSession';
import { resultExporter } from './nativeResultExport';
import { ExportCancelled } from './resultExportManager';
import { reportFileExporter } from '../diagnostics/reportFile';

export function useResultExport(contentScope: number | null) {
  const lifecycle = useRef(0);
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { const current = lifecycle.current; return () => { lifecycle.current = current + 1; }; }, []);
  async function run(kind: 'copy' | 'pdf', content: string) {
    if (busy.current) return;
    busy.current = true; setWorking(true); setMessage('');
    const generation = lifecycle.current;
    const current = () => generation === lifecycle.current && contentScope !== null && mobileSession.contentScope() === contentScope;
    try {
      await (kind === 'copy' ? resultExporter.copy(content, current) : resultExporter.pdf(content, current));
      if (current()) setMessage(kind === 'copy' ? 'Metnin tamamı kopyalandı.' : 'Paylaşım penceresi kapandı. Dosyanın gönderimini seçtiğiniz uygulamada kontrol edebilirsiniz.');
    } catch (error) {
      if (generation === lifecycle.current) setMessage(error instanceof ExportCancelled
        ? 'Toplantı veya oturum değiştiği için dışa aktarma iptal edildi.'
        : 'Dışa aktarma tamamlanmadı. Güncel uygulamayla yeniden deneyin; büyük dosyalarda geçici alanın temizlenmesi gerekebilir.');
    } finally {
      busy.current = false;
      if (generation === lifecycle.current) setWorking(false);
    }
  }
  return { working, message, copy: (text: string) => run('copy', text), pdf: (html: string) => run('pdf', html) };
}

export function useExportCacheCleanup() {
  useEffect(() => {
    // Threshold-based cleanup; a suspended/terminated JS process cannot promise a deadline.
    const clean = () => { void resultExporter.cleanup().catch(() => {}); void reportFileExporter.cleanup().catch(() => {}); };
    void resultExporter.cleanup(true).catch(() => {});
    void reportFileExporter.cleanup(true).catch(() => {});
    const listener = AppState.addEventListener('change', state => { if (state === 'active') clean(); });
    const timer = setInterval(clean, 60000);
    return () => { listener.remove(); clearInterval(timer); };
  }, []);
}
