import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import * as api from './liveTestApi';

export function PendingRecordingPanel({ beforeResolve, meetingId, onSeparateMeeting }: {
  beforeResolve: () => Promise<void>; meetingId?: string; onSeparateMeeting?: () => Promise<void>;
}) {
  const [loaded, setPending] = useState<{ meetingId?: string; value: Awaited<ReturnType<typeof api.pendingRecording>> } | null>(null);
  const pending = loaded?.meetingId === meetingId ? loaded?.value : null;
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const working = useRef(false);
  const restore = useEffectEvent(() => { void refresh(); });
  const cancelRead = useEffectEvent(() => { requestVersion.current++; });
  useEffect(() => {
    mounted.current = true; restore();
    return () => { mounted.current = false; cancelRead(); };
  }, [meetingId]);
  async function refresh() {
    const version = ++requestVersion.current;
    try {
      const session = await api.validSession(15000);
      const next = await api.pendingRecording(session.jwt, meetingId);
      if (mounted.current && requestVersion.current === version) setPending({ meetingId, value: next });
    } catch { if (mounted.current && requestVersion.current === version) setMessage('Bekleyen kayıt okunamadı. Bağlantıyı ve giriş yaptığınız hesabı kontrol edin.'); }
  }
  async function resolve(abandon: boolean) {
    if (!pending || working.current) return;
    const version = requestVersion.current;
    working.current = true; setBusy(true); setMessage('');
    try {
      await beforeResolve();
      const session = await api.validSession(30000);
      if (!mounted.current || requestVersion.current !== version) return;
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
    const version = requestVersion.current;
    Alert.alert('Eksik kaydı kapat?', 'Bu kayıt eksik olarak işaretlenecek. Gönderilememiş yerel ses silinecek; sunucuya ulaşmış metin korunur. Bu kaydı kurtarmaktan vazgeçmek istiyor musunuz?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Eksik olarak kapat', style: 'destructive', onPress: () => { if (mounted.current && version === requestVersion.current) void resolve(true); } },
    ]);
  }
  function confirmSeparateMeeting() {
    const version = requestVersion.current;
    Alert.alert('Ayrı bir toplantı aç?', 'Önceki kaydın kapanış bilgisi bu cihazda korunacak; tamamlandı sayılmayacak. Yeni toplantı ayrı açılacak. Mikrofonu ardından Başlat düğmesiyle açabilirsiniz.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Yeni toplantı aç', onPress: () => {
        if (!mounted.current || version !== requestVersion.current || working.current || !onSeparateMeeting) return;
        working.current = true; setBusy(true); setMessage('');
        void beforeResolve().then(() => {
          if (mounted.current && version === requestVersion.current) return onSeparateMeeting();
          return undefined;
        }).catch(error => {
          if (mounted.current) setMessage(error instanceof Error ? error.message : 'Yeni toplantı açılamadı.');
        }).finally(() => { working.current = false; if (mounted.current) setBusy(false); });
      } },
    ]);
  }
  if (!pending && !message) return null;
  return <View style={styles.panel}>
    {pending && <>
      <Text style={styles.text}>{pending.meetingId === meetingId || !meetingId ? 'Bekleyen kayıt' : 'Önceki toplantının bekleyen kaydı'}</Text>
      <Text style={styles.text}>{pending.incomplete
        ? 'Bu kaydın eksiksiz kapanışı doğrulanmadı. Kapanış bilgisini koruyarak ayrı bir toplantı açabilirsiniz.'
        : 'Ses kapanışı doğrulandı; sunucuya kapanış bilgisi tekrar iletilecek.'}</Text>
      {(!pending.incomplete || pending.abandoning) && <Pressable accessibilityRole="button" disabled={busy} onPress={() => void resolve(pending.abandoning)}>
        <Text style={styles.link}>{busy ? 'Kontrol ediliyor…' : 'Kapanışı tekrar kontrol et'}</Text>
      </Pressable>}
      {onSeparateMeeting && <Pressable accessibilityRole="button" disabled={busy} onPress={confirmSeparateMeeting}>
        <Text style={styles.link}>Önceki kaydı koru, yeni toplantı aç</Text>
      </Pressable>}
      {pending.incomplete && !pending.abandoning && <Pressable accessibilityRole="button" disabled={busy} onPress={confirmAbandon}>
        <Text style={styles.link}>Eksik kaydı kapat ve yeni kayda geç</Text>
      </Pressable>}
    </>}
    {!!message && <Text accessibilityRole="alert" style={styles.text}>{message}</Text>}
  </View>;
}
const styles = StyleSheet.create({ panel: { backgroundColor: '#1e293b', padding: 10 },
  text: { color: '#e2e8f0', paddingVertical: 4 }, link: { color: '#93c5fd', paddingVertical: 10 } });
