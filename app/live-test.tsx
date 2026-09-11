import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { AudioModule, useAudioStream } from 'expo-audio';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams } from 'expo-router';
import { ForegroundStream, type LiveSocket } from '../src/audio/foregroundStream';
import { applyTranscriptEvent, type TranscriptLine } from '../src/transcript/transcriptState';
import { TranscriptView } from '../src/transcript/TranscriptView';
import { OfflineAudioBuffer } from '../src/audio/offlineBuffer';
import * as api from '../src/audio/liveTestApi';
import { NewMeetingForm } from '../src/audio/NewMeetingForm';
import { configureBackgroundCapture, supportsBackgroundCapture } from '../src/audio/backgroundCapture';
import { SessionExpired } from '../src/auth/sessionManager';
import { LiveAnalysisPanel } from '../src/analysis/LiveAnalysisPanel';
import { newerAnalysis, type AnalysisSnapshot } from '../src/analysis/liveAnalysis';
import { subscribeAnalysis } from '../src/analysis/analysisSubscription';
import { PersistedResultPanel } from '../src/analysis/PersistedResultPanel';

WebBrowser.maybeCompleteAuthSession();

export default function LiveTestScreen() {
  const { authRestart } = useLocalSearchParams<{ authRestart?: string }>();
  const [status, setStatus] = useState(authRestart === '1'
    ? 'Uygulama yeniden açıldığı için giriş işlemi tamamlanamadı. Lütfen yeniden giriş yapın.'
    : 'Önce giriş yapın, ardından bir toplantı seçin.');
  const [list, setList] = useState<api.Meeting[]>([]);
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [recording, setRecording] = useState(false);
  const [background, setBackground] = useState(false);
  const [tab, setTab] = useState<'text' | 'summary' | 'decisions' | 'actions' | 'saved' | 'diagnostics'>('text');
  const [setup, setSetup] = useState(true);
  const backgroundActive = useRef(false);
  const captureStarted = useRef(false);
  const [signedIn, setSignedIn] = useState(false);
  const [lines, setLines] = useState<readonly TranscriptLine[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisSnapshot | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState('Kayıt başladığında canlı analiz beklenecek.');
  const stopAnalysis = useRef<(() => void) | null>(null);
  const token = useRef<Awaited<ReturnType<typeof api.login>> | null>(null);
  const live = useRef<ForegroundStream | null>(null);
  const session = useRef<string | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const permissionPending = useRef(false);
  const failure = useRef<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const stage = useRef('Başlatma');
  function markStage(value: string) {
    stage.current = value;
    setStatus(value + '…');
    setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | ${value}`].slice(-30));
  }
  const stopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { stream } = useAudioStream({ sampleRate: 16000, channels: 1, encoding: 'int16',
    onBuffer: (buffer) => live.current?.send(buffer.data, buffer.sampleRate, buffer.channels, Date.now()),
  });

  async function stop() {
    if (!active.current) return;
    active.current = false;
    captureStarted.current = false;
    backgroundActive.current = false;
    generation.current++;
    stopAnalysis.current?.(); stopAnalysis.current = null;
    clearTimeout(stopTimer.current);
    setAnalysisStatus('Test durdu; canlı analiz bağlantısı kapatıldı.');
    stream.stop();
    setRecording(false);
    setBusy(true);
    setStatus('Son sözler bekleniyor…');
    const connection = live.current;
    const id = session.current;
    setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | Durdurma istendi`].slice(-30));
    live.current = null;
    session.current = null;
    try {
      const drained = await connection?.stop();
      if (id && token.current) { token.current = await api.validSession(15000); await api.finish(token.current.jwt, id); }
      setStatus(failure.current ?? (drained ? 'Test bitti. Ekrandaki metni konuşmanızla karşılaştırabilirsiniz.' : 'Test durdu; son sözlerin tamamlandığı doğrulanamadı.'));
    } catch { setStatus(failure.current ?? 'Test durdu; sunucudaki kapanış doğrulanamadı.'); }
    finally {
      if (failure.current) setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | ${failure.current}`].slice(-30));
      connection?.dispose();
      void configureBackgroundCapture(false).catch(() => {});
      setBusy(false);
    }
  }

  const stopRef = useRef(stop);
  useEffect(() => { stopRef.current = stop; });
  useEffect(() => {
    const listener = stream.addListener?.('audioStreamStatus', (event) => {
      if (!event.isStreaming && active.current && captureStarted.current) {
        failure.current = 'Kayıt cihaz tarafından veya kayıt bildiriminden durduruldu.';
        void stopRef.current();
      }
    });
    return () => listener?.remove();
  }, [stream]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      // The system permission dialog can temporarily deactivate the app.
      // No audio has started during this phase.
      if (state !== 'active' && !permissionPending.current && !backgroundActive.current) {
        if (active.current) failure.current = 'Uygulama arka plana geçtiği için test durduruldu.';
        void stopRef.current();
      }
    });
    return () => { listener.remove(); void stopRef.current(); };
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const restored = await api.restoreSession();
        if (!mounted || !restored) return;
        token.current = restored;
        setSignedIn(true);
        const meetings = await api.meetings(restored.jwt);
        if (mounted) { setList(meetings); setStatus('Oturumunuz açıldı. Bir toplantı seçin.'); }
      } catch {
        if (mounted) setStatus('Kayıtlı oturum açılamadı. Bağlantıyı kontrol edin veya yeniden giriş yapın.');
      } finally { if (mounted) setBusy(false); }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    let renewing = false;
    async function renew() {
      if (!signedIn || renewing || busy || recording || AppState.currentState !== 'active') return;
      renewing = true;
      try {
        const refreshed = await api.validSession();
        if (mounted) token.current = refreshed;
      } catch (error) {
        if (mounted) {
          if (error instanceof SessionExpired) {
            token.current = null; setSignedIn(false); setList([]); setSelected(undefined); setLines([]); setAnalysis(null);
          }
          setStatus(error instanceof SessionExpired ? error.message : 'Oturum yenilenemedi; bağlantı yeniden kontrol edilecek.');
        }
      } finally { renewing = false; }
    }
    const timer = setInterval(() => void renew(), 30000);
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void renew(); });
    return () => { mounted = false; clearInterval(timer); listener.remove(); };
  }, [signedIn, busy, recording]);

  async function signOut() {
    setBusy(true);
    token.current = null; setSignedIn(false); setList([]); setSelected(undefined);
    setLines([]); setAnalysis(null); setDiagnostics([]);
    stopAnalysis.current?.(); stopAnalysis.current = null;
    try {
      const serverConfirmed = await api.logout();
      setStatus(serverConfirmed ? 'Uygulamadan çıkış yapıldı.' : 'Cihazdan çıkış yapıldı; sunucu çıkışı bağlantı nedeniyle doğrulanamadı.');
    } catch { setStatus('Cihazdaki oturum kaydı silinemedi. Çıkışı yeniden deneyin.'); }
    finally { setBusy(false); }
  }

  async function signIn() {
    token.current = null;
    setSignedIn(false);
    setList([]); setSelected(undefined); setLines([]); setAnalysis(null);
    stopAnalysis.current?.(); stopAnalysis.current = null;
    setBusy(true);
    setStatus('Giriş bekleniyor…');
    try {
      token.current = await api.login();
      setSignedIn(true);
      setList(await api.meetings(token.current.jwt));
      setStatus('Bir toplantı seçin.');
    } catch (error) {
      token.current = null;
      setStatus(error instanceof Error ? error.message : 'Giriş tamamlanamadı.');
    } finally { setBusy(false); }
  }

  async function refreshMeetings() {
    setBusy(true);
    try {
      token.current = await api.validSession();
      const next = await api.meetings(token.current.jwt);
      setList(next); setSelected((current) => next.some(item => item.id === current) ? current : undefined);
      setStatus('Toplantı listesi yenilendi.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Toplantı listesi yenilenemedi.'); }
    finally { setBusy(false); }
  }

  async function createMeeting(title: string) {
    setBusy(true);
    try {
      token.current = await api.validSession();
      const meeting = await api.createMeeting(token.current.jwt, title);
      setList(previous => [meeting, ...previous.filter(item => item.id !== meeting.id)]);
      setSelected(meeting.id); setLines([]); setAnalysis(null);
      setStatus('Yeni toplantı oluşturuldu ve seçildi. Konuşma testini başlatabilirsiniz.');
    } catch (error) {
      setStatus(`${error instanceof Error ? error.message : 'Toplantı oluşturma sonucu alınamadı.'}\nTekrar oluşturmadan önce listeyi yenileyin; ilk istek kaydedilmiş olabilir.`);
      throw error;
    } finally { setBusy(false); }
  }

  async function start() {
    if (Platform.OS === 'web') { setStatus('Bu testi Android veya iOS uygulamasında açın.'); return; }
    if (active.current || !selected || !token.current) return;
    active.current = true;
    failure.current = null;
    setDiagnostics([`Mobil tanılama v1 | Deneme: ${Crypto.randomUUID()} | UTC: ${new Date().toISOString()}`]);
    const run = ++generation.current;
    setBusy(true);
    setLines([]);
    setAnalysis(null);
    markStage('Mikrofon izni');
    try {
      markStage('Oturum geçerliliği');
      token.current = await api.validSession(120000);
      if (generation.current !== run) return;
      markStage('Mikrofon izni');
      permissionPending.current = true;
      const permission = await AudioModule.requestRecordingPermissionsAsync()
        .finally(() => { permissionPending.current = false; });
      if (!permission.granted) {
        Alert.alert('Mikrofon izni gerekiyor', 'Konuşmanızın yazıya dönüşmesi için Ayarlar’dan mikrofon iznini açabilirsiniz.',
          [{ text: 'Kapat' }, { text: 'Ayarlar', onPress: () => void Linking.openSettings() }]);
        throw new Error('Mikrofon izni verilmedi.');
      }
      if (generation.current !== run) return;
      if (AppState.currentState === 'background') throw new Error('Teste başlamak için uygulamayı ön planda tutun.');
      markStage('Kayıt bildirimi');
      permissionPending.current = true;
      try { await configureBackgroundCapture(background); }
      finally { permissionPending.current = false; }
      if (generation.current !== run) return;
      if (['background'].includes(AppState.currentState)) throw new Error('Kaydı başlatmak için uygulamaya dönün.');
      const id = await api.begin(token.current.jwt, selected, markStage);
      if (generation.current !== run) { await api.finish(token.current.jwt, id); return; }
      session.current = id;
      setDiagnostics((previous) => [...previous, `Ses oturumu: ${id}`].slice(-30));
      markStage('Ses bağlantısının açılması');
      stopAnalysis.current = subscribeAnalysis({ baseUrl: api.BASE_URL, meetingId: selected, token: token.current.jwt,
        onSnapshot: (snapshot) => { if (generation.current === run) setAnalysis((previous) => newerAnalysis(previous, snapshot)); },
        onStatus: (message) => { if (generation.current === run) setAnalysisStatus(message); },
      });
      const NativeWebSocket = WebSocket as unknown as new (url: string, protocols: string[] | undefined, options: { headers: Record<string, string> }) => LiveSocket;
      const socket = new NativeWebSocket(`${api.BASE_URL.replace('https:', 'wss:')}/api/v1/audio-gateway/sessions/${encodeURIComponent(id)}/stream`, undefined,
        { headers: { Authorization: `Bearer ${token.current.jwt}` } });
      live.current = new ForegroundStream(socket as unknown as LiveSocket, () => {
        if (generation.current !== run) return;
        markStage('Sunucu hazır; mikrofon başlatılıyor');
        void stream.start().then(() => {
          if (generation.current !== run) { stream.stop(); return; }
          if (stream.sampleRate !== 16000 || stream.channels !== 1) throw new Error('Desteklenmeyen mikrofon biçimi.');
          if (background && !stream.isStreaming) throw new Error('Arka plan kayıt servisi başlatılamadı.');
          captureStarted.current = true;
          backgroundActive.current = background;
          setRecording(true); setBusy(false); setStatus('Dinleniyor — konuşabilirsiniz. Test 60 saniye sonra durur.');
          setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | Mikrofon başladı`].slice(-30));
          stopTimer.current = setTimeout(() => void stopRef.current(), 60000);
        }).catch(() => {
          if (generation.current !== run) return;
          failure.current = 'Mikrofon başlatılamadı veya gerekli 16 kHz mono ses biçimi sağlanamadı.';
          void stopRef.current();
        });
      }, (line) => {
        setLines((previous) => applyTranscriptEvent({ lines: previous }, line.final
          ? { type: 'final', seq: line.seq, text: line.text }
          : { type: 'partial', seq: line.seq, confirmed: line.confirmed ?? '', tentative: line.tentative ?? line.text }).lines);
      }, (message) => { failure.current = message; setStatus(message); void stopRef.current(); },
      new OfflineAudioBuffer({ maxBytes: 2 * 1024 * 1024, maxChunks: 2000 }), {
        connect: async () => {
          const refreshed = await api.validSession(30000);
          if (generation.current !== run) throw new Error('Kayıt kapandı.');
          token.current = refreshed;
          return new NativeWebSocket(`${api.BASE_URL.replace('https:', 'wss:')}/api/v1/audio-gateway/sessions/${encodeURIComponent(id)}/stream`, undefined,
            { headers: { Authorization: `Bearer ${refreshed.jwt}` } });
        },
        onStatus: (message) => {
          if (generation.current === run) {
            setStatus(message);
            setDiagnostics(previous => [...previous, `${new Date().toISOString()} | ${message}`].slice(-30));
          }
        },
      });
    } catch (error) {
      if (error instanceof SessionExpired) { token.current = null; setSignedIn(false); setList([]); setSelected(undefined); }
      failure.current = `Aşama: ${stage.current}\n${error instanceof Error ? error.message : 'Test başlatılamadı; nedeni doğrulanmadı.'}`;
      await stopRef.current();
      setStatus(failure.current);
    }
  }

  return <View style={styles.page}>
    <Text style={styles.title}>Toplantı</Text>
    <Text style={styles.text}>{status}</Text>
    {recording && <Text accessibilityRole="alert" style={styles.recording}>● Mikrofon açık · Kayıt sürüyor</Text>}
    <Pressable accessibilityRole="button" onPress={() => setSetup(!setup)}><Text style={styles.selected}>{setup ? 'Toplantı ayarlarını gizle' : 'Toplantı seç / ayarlar'}</Text></Pressable>
    {setup && <ScrollView style={{ maxHeight: 200 }}>
    <Text style={styles.note}>{background ? `Arka planda kayıt açık. Kaydı uygulamadan${Platform.OS === 'android' ? ' veya kayıt bildiriminden' : ''} durdurabilirsiniz. Bu deneme 60 saniyedir.` : 'Bu kısa denemede ekran açık kalmalıdır.'} Kısa ağ kesintisinde yeniden bağlanmayı dener; düzelmezse test durur.</Text>
    {supportsBackgroundCapture() && <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={styles.note}>Ekran kapalıyken kayda devam et</Text>
      <Switch accessibilityLabel="Arka planda kayıt" value={background} disabled={busy || recording} onValueChange={setBackground} />
    </View>}
    <Pressable accessibilityState={{ disabled: busy || recording }} disabled={busy || recording} style={[styles.button, (busy || recording) && styles.disabled]} onPress={() => void signIn()}><Text style={styles.text}>Giriş yap</Text></Pressable>
    <Pressable disabled={busy || recording} style={[styles.button, (busy || recording) && styles.disabled]} onPress={() => void signOut()}><Text style={styles.text}>Çıkış yap</Text></Pressable>
    <View>
      {signedIn && <>
        <NewMeetingForm disabled={busy || recording} onCreate={createMeeting} />
        <Pressable accessibilityRole="button" disabled={busy || recording} onPress={() => void refreshMeetings()}><Text style={styles.text}>Listeyi yenile</Text></Pressable>
      </>}
      {list.map((meeting) => <Pressable key={meeting.id} disabled={busy || recording} onPress={() => setSelected(meeting.id)}>
        <Text style={[styles.text, selected === meeting.id && styles.selected]}>{selected === meeting.id ? '✓ ' : ''}{meeting.title}</Text>
      </Pressable>)}
    </View></ScrollView>}
    <Pressable accessibilityState={{ disabled: !selected || busy || recording }} disabled={!selected || busy || recording} style={[styles.button, (!selected || busy || recording) && styles.disabled]} onPress={() => Alert.alert('Konuşma testi', api.CONSENT,
      [{ text: 'Vazgeç' }, { text: 'Kabul et ve başlat', onPress: () => { setSetup(false); setTab('text'); void start(); } }])}><Text style={styles.text}>Konuşma testini başlat</Text></Pressable>
    <Pressable disabled={!recording && !busy} style={[styles.button, (!recording && !busy) && styles.disabled]} onPress={() => void stop()}><Text style={styles.text}>Durdur</Text></Pressable>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {([['text', 'Metin'], ['summary', 'Özet'], ['decisions', 'Kararlar'], ['actions', 'Aksiyonlar'], ['saved', 'Kaydedilen'], ['diagnostics', 'Tanılama']] as const).map(([key, label]) =>
        <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={{ padding: 8, borderBottomWidth: 2, borderBottomColor: tab === key ? '#93c5fd' : 'transparent' }}><Text style={styles.text}>{label}</Text></Pressable>)}
    </View>
    {tab === 'text' && <View style={{ flex: 1 }}><TranscriptView lines={lines} />{!lines.length && <Text style={styles.note}>Kayıt başladığında konuşmanız burada görünecek.</Text>}</View>}
    {tab !== 'text' && <ScrollView style={{ flex: 1 }}>
      {tab === 'saved' && signedIn && selected && !recording && !busy && <PersistedResultPanel key={selected} meetingId={selected} />}
      {tab === 'saved' && (!signedIn || !selected || recording || busy) && <Text style={styles.note}>Kaydı durdurup bir toplantı seçtikten sonra kalıcı sonucu açabilirsiniz.</Text>}
      {(tab === 'summary' || tab === 'decisions' || tab === 'actions') && <LiveAnalysisPanel snapshot={analysis} status={analysisStatus} section={tab} />}
      {tab === 'diagnostics' && <View>
        <Text style={styles.text}>Tanılama kaydı (bu deneme)</Text>
        <Text selectable style={styles.note}>{diagnostics.join('\n')}</Text>
        <Pressable style={styles.button} onPress={() => { void Share.share({ message: diagnostics.join('\n') }).catch(() => setStatus('Paylaşım açılamadı; tanılama metnini seçip kopyalayabilirsiniz.')); }}>
          <Text style={styles.text}>Tanılama kaydını paylaş</Text>
        </Pressable>
      </View>}
    </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0f172a', padding: 20, gap: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '600' },
  text: { color: '#e2e8f0', fontSize: 16, paddingVertical: 5 },
  note: { color: '#94a3b8', fontSize: 14 },
  button: { backgroundColor: '#1e40af', borderRadius: 8, padding: 10 },
  disabled: { opacity: 0.4 },
  recording: { color: '#fca5a5', fontSize: 14, fontWeight: '600' },
  meetings: { maxHeight: 140 }, selected: { color: '#93c5fd', fontWeight: '700' },
});
