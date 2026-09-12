import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { persistedResult } from '../audio/liveTestApi';
import type { PersistedResult } from './persistedResult';

type Props = {
  meetingId: string; load?: (id: string) => Promise<PersistedResult>; onDiagnostic?: (message: string) => void;
};
export function PersistedResultPanel(props: Props) {
  return <ResultForMeeting key={props.meetingId} {...props} />;
}
function ResultForMeeting({ meetingId, load = persistedResult, onDiagnostic }: Props) {
  const [result, setResult] = useState<PersistedResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState(false);
  const lifecycle = useRef({ generation: 0 });
  const pending = useRef(false);
  useEffect(() => {
    const instance = lifecycle.current;
    return () => { instance.generation++; };
  }, []);
  async function refresh() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setResult(null); setError(''); setSources(false);
    const run = lifecycle.current.generation;
    onDiagnostic?.('Kalıcı sonuç okuma isteği başlatıldı');
    try {
      const next = await load(meetingId);
      if (run !== lifecycle.current.generation) return;
      if (next.meetingId !== meetingId) throw new Error('Sonuç seçilen toplantıyla eşleşmiyor.');
      setResult(next);
      onDiagnostic?.('Kalıcı sonuç alındı ve toplantı eşleşmesi doğrulandı');
    } catch (e) {
      if (run === lifecycle.current.generation) {
        const message = e instanceof Error ? e.message : 'Kalıcı sonuç okunamadı.';
        setError(message); onDiagnostic?.(message);
      }
    } finally { if (run === lifecycle.current.generation) { pending.current = false; setBusy(false); } }
  }
  return <View style={styles.panel}>
    <Text style={styles.title}>Kaydedilmiş toplantı sonucu</Text>
    <Text style={styles.text}>Toplantının sunucuda saklanan en son analizidir; son kayıt denemenizden önceki bir oturuma ait olabilir.</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void refresh()}>
      <Text style={styles.link}>{busy ? 'Sonuç okunuyor…' : 'Kalıcı sonucu aç / yenile'}</Text>
    </Pressable>
    {!!error && <Text accessibilityRole="alert" style={styles.text}>{error}</Text>}
    {result && <>
      <Text style={styles.text}>Oluşturulma: {result.generatedAt}</Text>
      <Text selectable style={styles.text}>Oturum: {result.sessionId}</Text>
      {!!result.summary && <Text style={styles.text}>{result.summary}</Text>}
      {result.decisions.map((d, i) => <Text key={i} style={styles.text}>• {d}</Text>)}
      {result.actions.map((a, i) => <View key={i}><Text style={styles.text}>{a.text}</Text>
        <Text style={styles.text}>Sorumlu: {a.owner ?? 'Belirtilmedi'} · Tarih: {a.dueDate ?? 'Belirtilmedi'}</Text></View>)}
      <Pressable accessibilityRole="button" onPress={() => setSources(!sources)}><Text style={styles.link}>{sources ? 'Kaynakları gizle' : 'Kaynakları göster'}</Text></Pressable>
      {sources && (result.sources.length ? result.sources.map((s, i) => <View key={i}>
        <Text style={styles.title}>{s.claim}</Text><Text selectable style={styles.text}>{s.text}</Text>
        <Text style={styles.text}>Kaynak {i + 1}</Text>
      </View>) : <Text style={styles.text}>Bu sonuçta kaynak alıntısı bulunmuyor.</Text>)}
    </>}
  </View>;
}
const styles = StyleSheet.create({ panel: { padding: 12, gap: 10, backgroundColor: '#1e293b', marginVertical: 12 },
  title: { color: '#fff', fontWeight: '600', fontSize: 17 }, text: { color: '#e2e8f0', fontSize: 15 },
  link: { color: '#93c5fd', paddingVertical: 12, fontSize: 16 } });
