import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { AudioModule, useAudioStream } from 'expo-audio';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams } from 'expo-router';
import { ForegroundStream, type LiveSocket } from '../src/audio/foregroundStream';
import { applyTranscriptEvent, type TranscriptLine } from '../src/transcript/transcriptState';
import { TranscriptView } from '../src/transcript/TranscriptView';
import Constants from 'expo-constants';
import { createRecordingBuffer } from '../src/audio/recordingBuffer';
import * as api from '../src/audio/liveTestApi';
import { NewMeetingForm } from '../src/audio/NewMeetingForm';
import { configureBackgroundCapture, supportsBackgroundCapture } from '../src/audio/backgroundCapture';
import { SessionExpired } from '../src/auth/sessionManager';
import { LiveAnalysisPanel } from '../src/analysis/LiveAnalysisPanel';
import { newerAnalysis, type AnalysisSnapshot } from '../src/analysis/liveAnalysis';
import { subscribeAnalysis } from '../src/analysis/analysisSubscription';
import { PersistedResultPanel } from '../src/analysis/PersistedResultPanel';
import { saveMeetingView, readMeetingView, clearMeetingViews } from '../src/audio/meetingViewCache';

WebBrowser.maybeCompleteAuthSession();

export default function LiveTestScreen() {
  const { authRestart, notificationMeetingId } = useLocalSearchParams<{ authRestart?: string; notificationMeetingId?: string }>();
  const handledNotification = useRef<string | undefined>(undefined);
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
  const analysisReceived = useRef(false);
  const token = useRef<Awaited<ReturnType<typeof api.login>> | null>(null);
  const live = useRef<ForegroundStream | null>(null);
  const audioBuffer = useRef<Awaited<ReturnType<typeof createRecordingBuffer>> | null>(null);
  const session = useRef<string | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const permissionPending = useRef(false);
  const failure = useRef<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const openNotificationMeeting = useEffectEvent((id: string) => {
    if (list.some(meeting => meeting.id === id)) {
      handledNotification.current = id;
      selectMeeting(id);
      setStatus('Bildirimdeki toplantı seçildi; kayıtlı sonuç kontrol ediliyor.');
    } else {
      setStatus('Bildirimdeki toplantı mevcut listede bulunamadı. Listeyi yenileyin; erişim yetkisi doğrulanmadan içerik açılmadı.');
    }
  });
  useEffect(() => {
    if (!notificationMeetingId || !signedIn || busy || active.current || handledNotification.current === notificationMeetingId) return;
    openNotificationMeeting(notificationMeetingId);
  }, [notificationMeetingId, signedIn, busy, list]);
  useEffect(() => {
    if (selected && signedIn) saveMeetingView(selected, { lines, analysis, diagnostics });
  }, [selected, signedIn, lines, analysis, diagnostics]);
  const stage = useRef('Başlatma');
  const diagnosticTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const analysisCount = useRef(0);
  function log(value: string) {
    setDiagnostics(previous => [...previous, `${new Date().toISOString()} | ${value}`].filter((_, index, all) => index < 3 || index >= all.length - 297));
  }
  function logTransport(connection: ForegroundStream | null) {
    if (!connection) { log('Ses taşıma bağlantısı oluşturulmadı.'); return; }
    const d = connection.diagnostics();
    log(`Ses: mikrofon tamponu=${d.capturedBuffers}, bayt=${d.capturedBytes}, üretilen parça=${d.generatedFrames}, gönderim denemesi=${d.sentFrames} (tekrarlar dahil), gateway onaylı=${d.acknowledgedFrames}, bekleyen=${d.pendingFrames}; son gönderilen sıra=${d.lastSentSeq}, son onay sırası=${d.lastAckSeq}`);
    log(`Son mikrofon=${d.lastCaptureUtc || 'yok'}; son gönderim=${d.lastSendUtc || 'yok'}; son gateway onayı=${d.lastAckUtc || 'yok'}; son metin=${d.lastTextUtc || 'yok'}; geçici metin olayı=${d.partialEvents}, kesin metin olayı=${d.finalEvents}`);
    log(`Ses sonu gönderimi=${d.eofUtc || 'yok'}; drained onayı=${d.drainedUtc || 'yok'}; WebSocket kapanış kodu=${d.closeCode || 'gözlenmedi'}; analiz sonucu sayısı=${analysisCount.current}. Gateway onayı STT/analiz tamamlandı anlamına gelmez.`);
  }
  function markStage(value: string) {
    stage.current = value;
    setStatus(value + '…');
    setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | ${value}`].filter((_, index, all) => index < 3 || index >= all.length - 297));
  }
  const { stream } = useAudioStream({ sampleRate: 16000, channels: 1, encoding: 'int16',
    onBuffer: (buffer) => live.current?.send(buffer.data, buffer.sampleRate, buffer.channels, Date.now()),
  });

  async function stop(reason = 'Belirtilmeyen durdurma çağrısı') {
    if (!active.current) return;
    active.current = false;
    captureStarted.current = false;
    backgroundActive.current = false;
    clearInterval(diagnosticTimer.current);
    log(`Durdurma nedeni: ${reason}`);
    stream.stop();
    setRecording(false);
    setBusy(true);
    setStatus('Son sözler bekleniyor…');
    const connection = live.current;
    const id = session.current;
    setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | Durdurma istendi`].filter((_, index, all) => index < 3 || index >= all.length - 297));
    live.current = null;
    session.current = null;
    try {
      const drained = await connection?.stop();
      log(`Ses akışı kapanış sonucu: ${drained ? 'drained doğrulandı' : 'drained doğrulanamadı'}`);
      if (id && token.current) { log('HTTP kayıt kapanışı başlatıldı'); token.current = await api.validSession(15000); await api.finish(token.current.jwt, id); log('HTTP kayıt kapanışı: FINISHED yanıtı doğrulandı'); }
      if (!failure.current && stopAnalysis.current && !analysisReceived.current) {
        setStatus('Ses kaydı bitti; analiz sonucu en fazla 20 saniye bekleniyor…');
        setAnalysisStatus('Son metin parçaları işlendi; analiz sonucu bekleniyor.');
        await new Promise<void>(resolve => setTimeout(resolve, 20_000));
      }
      setStatus(failure.current ?? (drained ? 'Test bitti. Ekrandaki metni konuşmanızla karşılaştırabilirsiniz.' : 'Test durdu; son sözlerin tamamlandığı doğrulanamadı.'));
    } catch (error) { log(`Kapanış başarısız: ${error instanceof Error ? error.message : 'nedeni alınamadı'}`); setStatus(failure.current ?? 'Test durdu; sunucudaki kapanış doğrulanamadı.'); }
    finally {
      try { logTransport(connection); } catch { log('Ses tamponu sayaçları okunamadı; kapanış temizliği sürüyor.'); }
      log('Analiz aboneliği istemci tarafından kapatılıyor. Sunucu analiz tetikleme/işleme aşamaları telefon tarafından doğrulanamaz.');
      generation.current++;
      stopAnalysis.current?.(); stopAnalysis.current = null;
      if (!analysisReceived.current && !failure.current) {
        setAnalysisStatus('Canlı analiz sonucu gelmedi. Tanılama kaydındaki analiz aşamasını sunucu kaydıyla eşleştirin.');
        setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | Canlı analiz sonucu 20 saniyede gelmedi`].filter((_, index, all) => index < 3 || index >= all.length - 297));
      }
      if (failure.current) setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | ${failure.current}`].filter((_, index, all) => index < 3 || index >= all.length - 297));
      connection?.dispose();
      const bufferHandle = audioBuffer.current;
      if (bufferHandle) {
        try { log('Ses tamponu kapanışı: ' + await bufferHandle.release()); audioBuffer.current = null; }
        catch { log('Şifreli tampon temizliği tamamlanamadı; teslim veya silinme doğrulanmadı.'); }
      }
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
        void stopRef.current('Cihaz veya bildirim kaydı durdurdu; ikisi native olaydan ayırt edilemiyor');
      }
    });
    return () => listener?.remove();
  }, [stream]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (active.current) log(`Uygulama durumu=${state}; arka plan kaydı=${backgroundActive.current}`);
      // The system permission dialog can temporarily deactivate the app.
      // No audio has started during this phase.
      if (state !== 'active' && !permissionPending.current && !backgroundActive.current) {
        if (active.current) failure.current = 'Uygulama arka plana geçtiği için test durduruldu.';
        void stopRef.current('Uygulama arka plana geçti; arka plan kaydı etkin değil');
      }
    });
    return () => { listener.remove(); void stopRef.current('Kayıt ekranından ayrılındı'); };
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
    clearMeetingViews();
    setBusy(true);
    token.current = null; setSignedIn(false); setList([]); setSelected(undefined);
    setLines([]); setAnalysis(null); setDiagnostics([]);
    analysisReceived.current = false;
    stopAnalysis.current?.(); stopAnalysis.current = null;
    try {
      const serverConfirmed = await api.logout();
      setStatus(serverConfirmed ? 'Uygulamadan çıkış yapıldı.' : 'Cihazdan çıkış yapıldı; sunucu çıkışı bağlantı nedeniyle doğrulanamadı.');
    } catch { setStatus('Cihazdaki oturum kaydı silinemedi. Çıkışı yeniden deneyin.'); }
    finally { setBusy(false); }
  }

  async function signIn() {
    clearMeetingViews();
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
      setList(next);
      if (!next.some(item => item.id === selected)) selectMeeting(undefined);
      setStatus('Toplantı listesi yenilendi.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Toplantı listesi yenilenemedi.'); }
    finally { setBusy(false); }
  }

  function selectMeeting(id: string | undefined) {
    if (id === selected) return;
    generation.current++;
    stopAnalysis.current?.(); stopAnalysis.current = null;
    const cached = id ? readMeetingView(id) : undefined;
    setSelected(id); setLines(cached?.lines ?? []); setAnalysis(cached?.analysis ?? null); setDiagnostics(cached?.diagnostics ?? []);
    setTab('saved');
    setAnalysisStatus(cached?.analysis ? 'Önceki canlı taslak geri getirildi; kalıcı sonuç Kaydedilen bölümünden doğrulanmalıdır.' : 'Bu ekranda canlı taslak yok; kaydedilmiş sonuç sunucudan kontrol ediliyor.');
  }

  async function createMeeting(title: string) {
    setBusy(true);
    try {
      token.current = await api.validSession();
      const meeting = await api.createMeeting(token.current.jwt, title);
      setList(previous => [meeting, ...previous.filter(item => item.id !== meeting.id)]);
      selectMeeting(meeting.id);
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
    analysisCount.current = 0;
    setDiagnostics([`Mobil tanılama v2 | Deneme: ${Crypto.randomUUID()} | UTC: ${new Date().toISOString()} | Toplantı: ${selected}`, 'Otomatik süre sınırı yok. Ham ses, konuşma içeriği ve token rapora dahil edilmez. Uygulama zorla kapatılırsa son olay kaydedilemeyebilir.']);
    const run = ++generation.current;
    setTab('text');
    setBusy(true);
    setLines([]);
    setAnalysis(null);
    markStage('Mikrofon izni');
    try {
      if (audioBuffer.current) { await audioBuffer.current.release(); audioBuffer.current = null; }
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
      setDiagnostics((previous) => [...previous.slice(0, 2), `Ses oturumu: ${id}`, ...previous.slice(2)]);
      markStage('Ses tamponu hazırlanıyor');
      const preparedBuffer = await createRecordingBuffer({
        retentionMs: Constants.expoConfig?.extra?.audioBufferRetentionMs, sessionId: id,
        ownerScope: () => api.lifecycleOwner(token.current!.jwt),
        onStorageError: () => {
          if (generation.current !== run) return;
          failure.current = 'Şifreli ses tamponuna erişilemedi; kayıt durduruldu.';
          void stopRef.current('Şifreli depolama hatası');
        },
      });
      if (generation.current !== run || !active.current) { await preparedBuffer.release(); return; }
      audioBuffer.current = preparedBuffer;
      log(preparedBuffer.mode === 'memory' ? 'Kalıcı ses tamponu kapalı: saklama süresi tanımlanmadı.' : 'Şifreli ses tamponu hazır.');
      markStage('Ses bağlantısının açılması');
      analysisReceived.current = false;
      stopAnalysis.current = subscribeAnalysis({ baseUrl: api.BASE_URL, meetingId: selected, token: token.current.jwt,
        onSnapshot: (snapshot) => { if (generation.current === run) { analysisCount.current++; log(`Analiz sonucu alındı: adet=${analysisCount.current}`); analysisReceived.current = true; setAnalysisStatus('Canlı analiz sonucu alındı; yeni sonuçlar geldikçe güncellenecek.'); setAnalysis((previous) => newerAnalysis(previous, snapshot)); } },
        onStatus: (message) => { if (generation.current === run) { setAnalysisStatus(message); setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | Analiz: ${message}`].filter((_, index, all) => index < 3 || index >= all.length - 297)); } },
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
          setRecording(true); setBusy(false); setStatus('Dinleniyor — konuşabilirsiniz. Bitirmek için Durdur düğmesine basın.');
          setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | Mikrofon başladı`].filter((_, index, all) => index < 3 || index >= all.length - 297));
          log('Mikrofon açık; otomatik süre sınırı yok');
          diagnosticTimer.current = setInterval(() => logTransport(live.current), 10000);
        }).catch(() => {
          if (generation.current !== run) return;
          failure.current = 'Mikrofon başlatılamadı veya gerekli 16 kHz mono ses biçimi sağlanamadı.';
          void stopRef.current('Mikrofon başlatma hatası');
        });
      }, (line) => {
        setLines((previous) => applyTranscriptEvent({ lines: previous }, line.final
          ? { type: 'final', seq: line.seq, text: line.text }
          : { type: 'partial', seq: line.seq, confirmed: line.confirmed ?? '', tentative: line.tentative ?? line.text }).lines);
      }, (message) => { log(`Ses bağlantısı hatası: ${message}`); failure.current = message; setStatus(message); void stopRef.current('Ses aktarımı veya WebSocket hatası'); },
      preparedBuffer.buffer, {
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
            setDiagnostics(previous => [...previous, `${new Date().toISOString()} | ${message}`].filter((_, index, all) => index < 3 || index >= all.length - 297));
          }
        },
      });
    } catch (error) {
      if (error instanceof SessionExpired) { token.current = null; setSignedIn(false); setList([]); setSelected(undefined); }
      failure.current = `Aşama: ${stage.current}\n${error instanceof Error ? error.message : 'Test başlatılamadı; nedeni doğrulanmadı.'}`;
      await stopRef.current('Başlatma aşaması başarısız');
      setStatus(failure.current);
    }
  }

  return <View style={styles.page}>
    <Text style={styles.title}>Toplantı</Text>
    <Text style={styles.text}>{status}</Text>
    {recording && <Text accessibilityRole="alert" style={styles.recording}>● Mikrofon açık · Kayıt sürüyor</Text>}
    <Pressable accessibilityRole="button" onPress={() => setSetup(!setup)}><Text style={styles.selected}>{setup ? 'Toplantı ayarlarını gizle' : 'Toplantı seç / ayarlar'}</Text></Pressable>
    {setup && <View>
    <Text style={styles.note}>{background ? `Arka planda kayıt açık. Kaydı uygulamadan${Platform.OS === 'android' ? ' veya kayıt bildiriminden' : ''} durdurabilirsiniz. Otomatik süre sınırı yoktur.` : 'Bu kısa denemede ekran açık kalmalıdır.'} Kısa ağ kesintisinde yeniden bağlanmayı dener; düzelmezse test durur.</Text>
    {supportsBackgroundCapture() && <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={styles.note}>Ekran kapalıyken kayda devam et</Text>
      <Switch accessibilityLabel="Arka planda kayıt" value={background} disabled={busy || recording} onValueChange={setBackground} />
    </View>}
    {Platform.OS === 'android' && !supportsBackgroundCapture() && <Text style={styles.note}>Arka plan kaydı bu APK’da hazır değil. Uygulama ekran açıkken kayıt yapabilir.</Text>}
    <ScrollView style={{ maxHeight: 150 }}>
    <Pressable accessibilityState={{ disabled: busy || recording }} disabled={busy || recording} style={[styles.button, (busy || recording) && styles.disabled]} onPress={() => void signIn()}><Text style={styles.text}>Giriş yap</Text></Pressable>
    <Pressable disabled={busy || recording} style={[styles.button, (busy || recording) && styles.disabled]} onPress={() => void signOut()}><Text style={styles.text}>Çıkış yap</Text></Pressable>
    <View>
      {signedIn && <>
        <NewMeetingForm disabled={busy || recording} onCreate={createMeeting} />
        <Pressable accessibilityRole="button" disabled={busy || recording} onPress={() => void refreshMeetings()}><Text style={styles.text}>Listeyi yenile</Text></Pressable>
      </>}
      {list.map((meeting) => <Pressable key={meeting.id} disabled={busy || recording} onPress={() => selectMeeting(meeting.id)}>
        <Text style={[styles.text, selected === meeting.id && styles.selected]}>{selected === meeting.id ? '✓ ' : ''}{meeting.title}</Text>
      </Pressable>)}
    </View></ScrollView></View>}
    <Pressable accessibilityState={{ disabled: !selected || busy || recording }} disabled={!selected || busy || recording} style={[styles.button, (!selected || busy || recording) && styles.disabled]} onPress={() => Alert.alert('Konuşma testi', api.CONSENT,
      [{ text: 'Vazgeç' }, { text: 'Kabul et ve başlat', onPress: () => { setSetup(false); setTab('text'); void start(); } }])}><Text style={styles.text}>Konuşma testini başlat</Text></Pressable>
    <Pressable disabled={!recording && !busy} style={[styles.button, (!recording && !busy) && styles.disabled]} onPress={() => void stop('Kullanıcı ekrandaki Durdur düğmesine bastı')}><Text style={styles.text}>Durdur</Text></Pressable>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {([['text', 'Metin'], ['summary', 'Özet'], ['decisions', 'Kararlar'], ['actions', 'Aksiyonlar'], ['saved', 'Kaydedilen'], ['diagnostics', 'Tanılama']] as const).map(([key, label]) =>
        <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={{ padding: 8, borderBottomWidth: 2, borderBottomColor: tab === key ? '#93c5fd' : 'transparent' }}><Text style={styles.text}>{label}</Text></Pressable>)}
    </View>
    {tab === 'text' && <View style={{ flex: 1 }}><TranscriptView lines={lines} />{!lines.length && <Text style={styles.note}>Kayıt başladığında konuşmanız burada görünecek.</Text>}</View>}
    {tab !== 'text' && <ScrollView style={{ flex: 1 }}>
      {tab === 'saved' && signedIn && selected && !recording && !busy && <PersistedResultPanel key={selected} meetingId={selected} onDiagnostic={log} />}
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
