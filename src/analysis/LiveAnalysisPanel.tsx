import { useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import type { AnalysisSnapshot } from './liveAnalysis';
import { analysisMarkdown } from './exportMarkdown';
import { printAsync } from 'expo-print';
import { analysisHtml } from './exportHtml';

export function LiveAnalysisPanel({ snapshot, status, section = 'all' }: { snapshot: AnalysisSnapshot | null; status: string; section?: 'all' | 'summary' | 'decisions' | 'actions' }) {
  const [shareError, setShareError] = useState('');
  const [sharing, setSharing] = useState(false);
  async function print() {
    if (!snapshot || sharing) return;
    setSharing(true); setShareError('');
    try { await printAsync({ html: analysisHtml(snapshot) }); }
    catch { setShareError('PDF/yazdırma tamamlanmadı veya pencere kapatıldı. Yeniden deneyebilirsiniz.'); }
    finally { setSharing(false); }
  }
  async function share() {
    if (!snapshot || sharing) return;
    setSharing(true); setShareError('');
    try { await Share.share({ message: analysisMarkdown(snapshot), title: 'Toplantı analizi — Markdown' }); }
    catch { setShareError('Paylaşım açılamadı. Yeniden deneyebilirsiniz.'); }
    finally { setSharing(false); }
  }
  return <View style={styles.panel} accessibilityLabel="Canlı toplantı analizi">
    <Text style={styles.title}>Toplantı sırasında analiz</Text>
    <Text style={styles.note}>{status}</Text>
    {!snapshot && <Text style={styles.text}>Henüz analiz sonucu alınmadı. Metnin görünmesi, analizin de geldiği anlamına gelmez.</Text>}
    {snapshot && <>
      <Text style={styles.note}>{snapshot.partial ? 'Canlı taslak — toplantı bitince değişebilir; nihai sonuç değildir.' : 'Son analiz'} · Sürüm {snapshot.version}</Text>
      {(section === 'all' || section === 'summary') && <Text style={styles.text}>{snapshot.summary || 'Bu sonuçta doğrulanmış özet yok.'}</Text>}
      {(section === 'all' || section === 'decisions') && <><Text style={styles.title}>Kararlar</Text>
      {!snapshot.decisions.length && <Text style={styles.text}>Bu analizde karar bulunmuyor.</Text>}
      {snapshot.decisions.map((text, index) => <Text key={index} style={styles.text}>• {text}</Text>)}</>}
      {(section === 'all' || section === 'actions') && <><Text style={styles.title}>Aksiyonlar</Text>
      {!snapshot.actions.length && <Text style={styles.text}>Bu analizde aksiyon bulunmuyor.</Text>}
      {snapshot.actions.map((action, index) => <View key={index} style={styles.action}>
        <Text style={styles.text}>{action.text}</Text>
        <Text style={styles.note}>Sorumlu: {action.owner ?? 'Belirtilmedi'} · Tarih: {action.dueDate ?? 'Belirtilmedi'}</Text>
      </View>)}</>}
      <Pressable accessibilityRole="button" disabled={sharing} onPress={() => void share()}>
        <Text style={styles.text}>{sharing ? 'Paylaşım açılıyor…' : snapshot.partial ? 'Canlı taslağı Markdown olarak paylaş' : 'Markdown olarak paylaş'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={sharing} onPress={() => void print()}>
        <Text style={styles.text}>{snapshot.partial ? 'Canlı taslağı PDF / Yazdır' : 'PDF / Yazdır'}</Text>
      </Pressable>
      {!!shareError && <Text accessibilityRole="alert" style={styles.note}>{shareError}</Text>}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  panel: { backgroundColor: '#1e293b', padding: 12, marginVertical: 12, borderRadius: 8, gap: 8 },
  title: { color: '#fff', fontSize: 17, fontWeight: '600' }, text: { color: '#e2e8f0', fontSize: 15 },
  note: { color: '#94a3b8', fontSize: 13 }, action: { paddingVertical: 6 },
});
