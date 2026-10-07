import { useLayoutEffect, useRef, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import { DiagnosticHistory } from './history';
import { diagnosticFailureDescription, type DiagnosticFailureCode } from './openFailure';
import { currentSourceLabel } from './sourceIdentity';
import { reportFileExporter } from './reportFile';
import { mobileSession } from '../auth/mobileSession';

export function HistoryPanel({ history, meetingId, failure, failureCode }: { history: DiagnosticHistory | null; meetingId?: string; failure: boolean; failureCode?: DiagnosticFailureCode }) {
  const [report, setReport] = useState<{ history: DiagnosticHistory; meeting: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const [scope, setScope] = useState({ history, meetingId });
  if (scope.history !== history || scope.meetingId !== meetingId) {
    setScope({ history, meetingId }); setError(''); setWorking(false);
  }
  useLayoutEffect(() => {
    const epoch = ++generation.current;
    busy.current = false;
    return () => { generation.current = epoch + 1; };
  }, [history, meetingId]);
  const captureScope = () => {
    const epoch = generation.current;
    const owner = mobileSession.contentScope();
    return () => epoch === generation.current && owner !== null && owner === mobileSession.contentScope();
  };
  const read = () => {
    if (!history || !meetingId) return '';
    return `${currentSourceLabel()}\nGeçmiş olayların kaynak sürümü kendi satırlarında bulunur; eski kayıtlarda olmayabilir.\n${history.report(meetingId)}`;
  };
  const share = async (kind: 'short' | 'full' | 'file') => {
    if (!history || !meetingId || busy.current) return;
    const current = captureScope();
    const epoch = generation.current;
    if (!current()) return;
    busy.current = true; setWorking(true); setError('');
    try {
      const text = kind === 'short' ? `${currentSourceLabel()}\n${history.shortReport(meetingId)}` : read();
      if (kind === 'file') await reportFileExporter.share(text, current);
      else { if (!current()) return; await Share.share({ message: text }); }
    } catch { if (current()) setError('Paylaşım tamamlanamadı. Kısa raporu deneyebilir veya dosya paylaşımı için birkaç dakika bekleyebilirsiniz.'); }
    finally { if (epoch === generation.current) { busy.current = false; setWorking(false); } }
  };
  return <View style={{ gap: 12, marginBottom: 20 }}>
    <Text style={{ color: '#fff', fontSize: 20 }}>Saklanan tanılama geçmişi</Text>
    <Text selectable style={{ color: '#94a3b8' }}>{currentSourceLabel()}</Text>
    <Text style={{ color: '#94a3b8' }}>Aynı hesapla yeniden girişte açılır. Son 30 gün ve hesap başına en fazla 20.000 teknik olay saklanır. Süresi dolan kayıtlar bu hesaba tekrar erişildiğinde temizlenir. Ses ve konuşma metni içermez.</Text>
    {failureCode && <Text accessibilityRole="alert" style={{ color: '#fca5a5' }}>Kalıcı tanılama açılamadı. {diagnosticFailureDescription(failureCode)} İnceleme kodu: {failureCode}</Text>}
    {!failureCode && (failure || history?.failed()) && <Text accessibilityRole="alert" style={{ color: '#fca5a5' }}>Tanılama geçmişinin diske yazılması doğrulanamadı. Bu oturumun bazı olayları eksik olabilir.</Text>}
    {!history && <Text style={{ color: '#94a3b8' }}>Kalıcı tanılama hazır değil. Mevcut denemenin geçici kaydı aşağıdadır.</Text>}
    {history && meetingId && <>
      <Pressable accessibilityRole="button" onPress={() => { try { setReport({ history, meeting: meetingId, text: read() }); } catch { setError('Tanılama geçmişi okunamadı.'); } }}>
        <Text style={{ color: '#93c5fd' }}>Saklanan geçmişi aç / yenile</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={working} onPress={() => { void share('short'); }}><Text style={{ color: '#93c5fd' }}>Son hata ve olayların kısa raporunu paylaş</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={working} onPress={() => { void share('file'); }}><Text style={{ color: '#93c5fd' }}>Tam tanılama geçmişini dosya olarak paylaş</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={working} onPress={() => { void share('full'); }}><Text style={{ color: '#93c5fd' }}>Toplantının tanılama geçmişini paylaş</Text></Pressable>
      {working && <Text style={{ color: '#94a3b8' }}>Paylaşım hazırlanıyor…</Text>}
      <Pressable accessibilityRole="button" onPress={() => { const current = captureScope(); Alert.alert('Tanılama geçmişini temizle?', 'Yalnız seçilen toplantının bu cihazdaki teknik geçmişi silinir.', [
        { text: 'Vazgeç', style: 'cancel' }, { text: 'Temizle', style: 'destructive', onPress: () => {
          if (!current()) return;
          try { history.clear(meetingId); setReport({ history, meeting: meetingId, text: read() }); } catch { setError('Tanılama geçmişi temizlenemedi.'); }
        } },
      ]); }}><Text style={{ color: '#93c5fd' }}>Bu toplantının tanılama geçmişini temizle</Text></Pressable>
    </>}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#fca5a5' }}>{error}</Text>}
    {report?.history === history && report?.meeting === meetingId && <Text selectable style={{ color: '#94a3b8' }}>{report.text}</Text>}
  </View>;
}
