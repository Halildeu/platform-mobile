import { useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import { DiagnosticHistory } from './history';
import { diagnosticFailureDescription, type DiagnosticFailureCode } from './openFailure';

export function HistoryPanel({ history, meetingId, failure, failureCode }: { history: DiagnosticHistory | null; meetingId?: string; failure: boolean; failureCode?: DiagnosticFailureCode }) {
  const [report, setReport] = useState<{ history: DiagnosticHistory; meeting: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const read = () => {
    if (!history || !meetingId) return '';
    return history.report(meetingId);
  };
  return <View style={{ gap: 12, marginBottom: 20 }}>
    <Text style={{ color: '#fff', fontSize: 20 }}>Saklanan tanılama geçmişi</Text>
    <Text style={{ color: '#94a3b8' }}>Aynı hesapla yeniden girişte açılır. Son 30 gün ve hesap başına en fazla 20.000 teknik olay saklanır. Süresi dolan kayıtlar bu hesaba tekrar erişildiğinde temizlenir. Ses ve konuşma metni içermez.</Text>
    {failureCode && <Text accessibilityRole="alert" style={{ color: '#fca5a5' }}>Kalıcı tanılama açılamadı. {diagnosticFailureDescription(failureCode)} İnceleme kodu: {failureCode}</Text>}
    {!failureCode && (failure || history?.failed()) && <Text accessibilityRole="alert" style={{ color: '#fca5a5' }}>Tanılama geçmişinin diske yazılması doğrulanamadı. Bu oturumun bazı olayları eksik olabilir.</Text>}
    {!history && <Text style={{ color: '#94a3b8' }}>Kalıcı tanılama hazır değil. Ayrıntılı rapor düğmeleri tanılama deposu açıldığında görünecek. Mevcut denemenin geçici kaydı aşağıdadır.</Text>}
    {history && meetingId && <>
      <Pressable accessibilityRole="button" onPress={() => { try { setReport({ history, meeting: meetingId, text: read() }); } catch { setError('Tanılama geçmişi okunamadı.'); } }}>
        <Text style={{ color: '#93c5fd' }}>Saklanan geçmişi aç / yenile</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => {
        try { const message = read(); void Share.share({ message }).catch(() => setError('Paylaşım tamamlanamadı.')); }
        catch { setError('Tanılama geçmişi okunamadı.'); }
      }}><Text style={{ color: '#93c5fd' }}>Toplantının tanılama geçmişini paylaş</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => Alert.alert('Tanılama geçmişini temizle?', 'Yalnız seçilen toplantının bu cihazdaki teknik geçmişi silinir.', [
        { text: 'Vazgeç', style: 'cancel' }, { text: 'Temizle', style: 'destructive', onPress: () => {
          try { history.clear(meetingId); setReport({ history, meeting: meetingId, text: read() }); } catch { setError('Tanılama geçmişi temizlenemedi.'); }
        } },
      ])}><Text style={{ color: '#93c5fd' }}>Bu toplantının tanılama geçmişini temizle</Text></Pressable>
    </>}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#fca5a5' }}>{error}</Text>}
    {report?.history === history && report?.meeting === meetingId && <Text selectable style={{ color: '#94a3b8' }}>{report.text}</Text>}
  </View>;
}
