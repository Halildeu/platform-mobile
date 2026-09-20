import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as api from './liveTestApi';

export function PendingRecordingPanel({ beforeResolve }: { beforeResolve: () => Promise<void> }) {
  const [pending, setPending] = useState<Awaited<ReturnType<typeof api.pendingRecording>>>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const working = useRef(false);
  const restore = useEffectEvent(() => { void refresh(); });
  useEffect(() => { mounted.current = true; restore(); return () => { mounted.current = false; }; }, []);
  async function refresh() {
    try {
      const session = await api.validSession(15000);
      const next = await api.pendingRecording(session.jwt);
      if (mounted.current) setPending(next);
    } catch { if (mounted.current) setMessage('Bekleyen kayıt okunamadı. Bağlantıyı ve giriş yaptığınız hesabı kontrol edin.'); }
  }
  async function resolve(abandon: boolean) {
    if (!pending || working.current) return;
    working.current = true; setBusy(true); setMessage('');
    try {
      await beforeResolve();
      const session = await api.validSession(30000);
      if (abandon) await api.abandonRecording(session.jwt, pending.sessionId);
      else await api.finish(session.jwt, pending.sessionId);
      if (mounted.current) {
        setPending(null);
        setMessage(abandon ? 'Kayıt eksik olarak kapatıldı. Yeni kayıt başlatabilirsiniz.' : 'Önceki kaydın sunucu kapanışı doğrulandı.');
      }
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : 'Kayıt kapanışı doğrulanamadı.');
      await refresh();
    } finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  function confirmAbandon() {
    Alert.alert('Eksik kaydı kapat?', 'Bu kayıt eksik olarak işaretlenecek. Gönderilememiş yerel ses silinecek; sunucuya ulaşmış metin korunur. Bu kaydı kurtarmaktan vazgeçmek istiyor musunuz?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Eksik olarak kapat', style: 'destructive', onPress: () => void resolve(true) },
    ]);
  }
  if (!pending && !message) return null;
  return <View style={styles.panel}>
    {pending && <>
      <Text style={styles.text}>Bekleyen kayıt</Text>
      <Text style={styles.text}>{pending.incomplete
        ? 'Sesin tamamının işlendiği doğrulanmadı. Yeni kayıttan önce bu kaydın durumunu kontrol edin.'
        : 'Ses kapanışı doğrulandı; sunucuya kapanış bilgisi tekrar iletilecek.'}</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void resolve(pending.abandoning)}>
        <Text style={styles.link}>{busy ? 'Kontrol ediliyor…' : 'Kapanışı tekrar kontrol et'}</Text>
      </Pressable>
      {pending.incomplete && !pending.abandoning && <Pressable accessibilityRole="button" disabled={busy} onPress={confirmAbandon}>
        <Text style={styles.link}>Eksik kaydı kapat ve yeni kayda geç</Text>
      </Pressable>}
    </>}
    {!!message && <Text accessibilityRole="alert" style={styles.text}>{message}</Text>}
  </View>;
}
const styles = StyleSheet.create({ panel: { backgroundColor: '#1e293b', padding: 10 },
  text: { color: '#e2e8f0', paddingVertical: 4 }, link: { color: '#93c5fd', paddingVertical: 10 } });
