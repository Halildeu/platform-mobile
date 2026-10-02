import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { printAsync } from 'expo-print';
import { analysisHtml } from './exportHtml';
import { analysisMarkdown } from './exportMarkdown';
import { persistedResult } from '../audio/liveTestApi';
import type { PersistedResult } from './persistedResult';
import { recordingResultNotices } from './recordingResultNotices';
import { mobileSession } from '../auth/mobileSession';
import { useResultExport } from './useResultExport';
import { ProcessingStatusPanel } from './ProcessingStatusPanel';


type Props = {
  meetingId: string; load?: (id: string) => Promise<PersistedResult>; onDiagnostic?: (message: string) => void;
  section?: 'all' | 'summary' | 'decisions' | 'actions';
};
export function PersistedResultPanel(props: Props) {
  return <ResultForMeeting key={props.meetingId} {...props} />;
}
function ResultForMeeting({ meetingId, load = persistedResult, onDiagnostic, section = 'all' }: Props) {
  const [result, setResult] = useState<PersistedResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const exporting = useRef(false);
  const lifecycle = useRef({ generation: 0 });
  const pending = useRef(false);
  const [scope, setScope] = useState<number | null>(null);
  const exports = useResultExport(scope);
  // The keyed meeting mounts once; diagnostic callback updates must not reload it.
  const restoreOnMount = useEffectEvent(() => { void refresh(); });
  useEffect(() => { restoreOnMount(); }, []);
  useEffect(() => {
    const instance = lifecycle.current;
    return () => { instance.generation++; };
  }, []);
  async function refresh() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    const run = lifecycle.current.generation;
    const owner = mobileSession.contentScope();
    onDiagnostic?.(`Kalıcı sonuç okuma isteği başlatıldı; toplantı=${meetingId}`);
    try {
      const next = await load(meetingId);
      if (run !== lifecycle.current.generation) return;
      if (owner === null || owner !== mobileSession.contentScope()) throw new Error('Oturum değişti; sonucu yeniden açın.');
      if (next.meetingId !== meetingId) throw new Error('Sonuç seçilen toplantıyla eşleşmiyor.');
      setResult(next); setScope(owner);
      onDiagnostic?.('Kalıcı sonuç alındı ve toplantı eşleşmesi doğrulandı');
    } catch (e) {
      if (run === lifecycle.current.generation) {
        setResult(null); setScope(null); setSources(false);
        const message = e instanceof Error ? e.message : 'Kalıcı sonuç okunamadı.';
        setError(message); onDiagnostic?.(message);
      }
    } finally { if (run === lifecycle.current.generation) { pending.current = false; setBusy(false); } }
  }
  async function exportResult(format: 'markdown' | 'pdf') {
    if (!result || busy || exporting.current || scope === null || mobileSession.contentScope() !== scope) return;
    exporting.current = true; setSharing(true); setShareError('');
    try {
      if (format === 'pdf') await printAsync({ html: analysisHtml(result) });
      else await Share.share({ title: 'Kaydedilmiş toplantı sonucu', message: analysisMarkdown(result) });
    } catch { setShareError('Paylaşım tamamlanmadı. Yeniden deneyebilirsiniz.'); }
    finally { exporting.current = false; setSharing(false); }
  }
  return <View style={styles.panel}>
    <Text style={styles.title}>Kaydedilmiş toplantı sonucu</Text>
    <Text style={styles.text}>Toplantının sunucuda saklanan en son analizidir; son kayıt denemenizden önceki bir oturuma ait olabilir.</Text>
    <Text style={styles.text}>Kayıt durduktan sonra kalıcı sonucun hazırlanması birkaç dakika sürebilir. Canlı taslak, kaydedilmiş sonuç değildir.</Text>
    <Pressable accessibilityRole="button" disabled={busy || exports.working || sharing} onPress={() => void refresh()}>
      <Text style={styles.link}>{busy ? 'Sonuç okunuyor…' : 'Kalıcı sonucu aç / yenile'}</Text>
    </Pressable>
    {!!error && <Text accessibilityRole="alert" style={styles.text}>{error}</Text>}
    <ProcessingStatusPanel meetingId={meetingId} />
    {result && <>
      {recordingResultNotices(result).map(notice => <Text key={notice} accessibilityRole="alert" style={styles.text}>{notice}</Text>)}
      <Text style={styles.text}>Oluşturulma: {result.generatedAt}</Text>
      <Text selectable style={styles.text}>Oturum: {result.sessionId}</Text>

      {(section === 'all' || section === 'summary') && <><Text style={styles.title}>Özet</Text>
      <Text selectable style={styles.text}>{result.summary || 'Bu sonuçta gösterilebilir özet bulunmuyor.'}</Text></>}
      {(section === 'all' || section === 'decisions') && <><Text style={styles.title}>Kararlar</Text>
      {!result.decisions.length && <Text style={styles.text}>Bu sonuçta karar bulunmuyor.</Text>}
      {result.decisions.map((d, i) => <Text selectable key={i} style={styles.text}>• {d}</Text>)}</>}
      {(section === 'all' || section === 'actions') && <><Text style={styles.title}>Aksiyonlar</Text>
      {!result.actions.length && <Text style={styles.text}>Bu sonuçta aksiyon bulunmuyor.</Text>}
      {result.actions.map((a, i) => <View key={i}><Text selectable style={styles.text}>{a.text}</Text>
        <Text selectable style={styles.text}>Sorumlu: {a.owner ?? 'Belirtilmedi'} · Tarih: {a.dueDate ?? 'Belirtilmedi'}</Text></View>)}</>}
      {section === 'all' && <>
      <Pressable accessibilityRole="button" onPress={() => setSources(!sources)}><Text style={styles.link}>{sources ? 'Kaynakları gizle' : 'Kaynakları göster'}</Text></Pressable>
      {sources && (result.sources.length ? result.sources.map((s, i) => <View key={i}>
        <Text style={styles.title}>{s.claim}</Text><Text selectable style={styles.text}>{s.text}</Text>
        <Text style={styles.text}>Kaynak {i + 1}</Text>
      </View>) : <Text style={styles.text}>Bu sonuçta kaynak alıntısı bulunmuyor.</Text>)}</>}
      {section !== 'all' && <Text style={styles.text}>Dışa aktarma özet, kararlar ve aksiyonların tamamını içerir.</Text>}
      <Pressable accessibilityRole="button" disabled={busy || sharing || exports.working} onPress={() => void exports.copy(analysisMarkdown(result))}>
        <Text style={styles.link}>Kaydedilmiş sonucun tamamını kopyala</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy || sharing || exports.working} onPress={() => void exportResult('markdown')}>
        <Text style={styles.link}>{section === 'all' ? 'Kaydedilmiş sonucu Markdown olarak paylaş' : 'Kaydedilmiş sonucun tamamını Markdown olarak paylaş'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy || sharing || exports.working} onPress={() => void exports.pdf(analysisHtml(result))}>
        <Text style={styles.link}>{section === 'all' ? 'Kaydedilmiş sonucu PDF olarak paylaş' : 'Kaydedilmiş sonucun tamamını PDF olarak paylaş'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy || sharing || exports.working} onPress={() => void exportResult('pdf')}>
        <Text style={styles.link}>{section === 'all' ? 'Kaydedilmiş sonucu yazdır' : 'Kaydedilmiş sonucun tamamını yazdır'}</Text>
      </Pressable>
      {!!exports.message && <Text accessibilityRole="alert" style={styles.text}>{exports.message}</Text>}
      {!!shareError && <Text accessibilityRole="alert" style={styles.text}>{shareError}</Text>}
    </>}
  </View>;
}
const styles = StyleSheet.create({ panel: { padding: 12, gap: 10, backgroundColor: '#1e293b', marginVertical: 12 },
  title: { color: '#fff', fontWeight: '600', fontSize: 17 }, text: { color: '#e2e8f0', fontSize: 15 },
  link: { color: '#93c5fd', paddingVertical: 12, fontSize: 16 } });
