import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import type { DiagnosticHistory } from './history';

export function DetailedReportPanel({ history, meetingId }: { history: DiagnosticHistory | null; meetingId?: string }) {
  const [report, setReport] = useState<{ history: DiagnosticHistory; meetingId: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const active = useRef<{ history: DiagnosticHistory | null; meetingId?: string } | null>(null);
  useEffect(() => {
    active.current = { history, meetingId };
    return () => { active.current = null; };
  }, [history, meetingId]);
  if (!history || !meetingId) return null;
  const current = () => active.current?.history === history && active.current?.meetingId === meetingId;
  const read = () => { if (!current()) return; try { setReport({ history, meetingId, text: history.detailedReport(meetingId) }); } catch { setError('Ayrıntılı rapor okunamadı.'); } };
  return <View style={{ gap: 12, marginBottom: 20 }}>
    <Text style={{ color: '#fff', fontSize: 20 }}>Ayrıntılı test raporu</Text>
    <Text style={{ color: '#94a3b8' }}>Yalnız seçerek açtığınız testlerde metin ve aksiyon içerikleri saklanır. Konuşma metni ve kişi adları içerebilir. Seçtiğiniz 1 veya 24 saat / 5.000 olay / 2 MiB; süresi dolan kayıtlar hesaba yeniden erişildiğinde temizlenir. Ham ses saklanmaz.</Text>
    <Pressable accessibilityRole="button" onPress={read}><Text style={{ color: '#93c5fd' }}>Ayrıntılı raporu aç / yenile</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => Alert.alert('İçerikli test raporunu paylaş?',
      'Raporda konuşma metni ve kişi adları olabilir. Yalnız inceleme için uygun alıcıyla paylaşın.', [
        { text: 'Vazgeç', style: 'cancel' }, { text: 'Paylaş', onPress: () => {
          if (!current()) return;
          try { const message = history.detailedReport(meetingId); void Share.share({ message }).catch(() => setError('Paylaşım tamamlanamadı.')); }
          catch { setError('Ayrıntılı rapor okunamadı.'); }
        } },
      ])}><Text style={{ color: '#93c5fd' }}>Ayrıntılı test raporunu paylaş</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => Alert.alert('Ayrıntılı test kaydını temizle?',
      'Yalnız bu toplantının cihazdaki ayrıntılı test kaydı silinir.', [{ text: 'Vazgeç', style: 'cancel' }, { text: 'Temizle', style: 'destructive', onPress: () => {
        if (!current()) return;
        try { history.clearDetails(meetingId); read(); } catch { setError('Ayrıntılı kayıt temizlenemedi.'); }
      } }])}><Text style={{ color: '#93c5fd' }}>Ayrıntılı test kaydını temizle</Text></Pressable>
    {!!error && <Text accessibilityRole="alert" style={{ color: '#fca5a5' }}>{error}</Text>}
    {report?.history === history && report.meetingId === meetingId && <Text selectable style={{ color: '#94a3b8' }}>{report.text}</Text>}
  </View>;
}
