import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { AudioModule, useAudioStream } from 'expo-audio';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ForegroundStream, type LiveSocket } from '../src/audio/foregroundStream';
import { applyTranscriptEvent, type TranscriptLine } from '../src/transcript/transcriptState';
import { TranscriptView } from '../src/transcript/TranscriptView';
import { SavedTranscript } from '../src/analysis/SavedTranscriptPanel';
import Constants from 'expo-constants';
import { DiagnosticHistory, diagnosticStage, type DiagnosticKind, type Details } from '../src/diagnostics/history';
import { messageEvent } from '../src/diagnostics/messageEvent';
import { HistoryPanel } from '../src/diagnostics/HistoryPanel';
import { openAccountHistory } from '../src/diagnostics/openAccountHistory';
import { diagnosticFailureCode, type DiagnosticFailureCode } from '../src/diagnostics/openFailure';
import { createRecordingBuffer } from '../src/audio/recordingBuffer';
import * as api from '../src/audio/liveTestApi';
import { NewMeetingForm } from '../src/audio/NewMeetingForm';
import { backgroundStopReason, configureBackgroundCapture, listenBackgroundStop, startPcmCapture, supportsBackgroundCapture } from '../src/audio/backgroundCapture';
import { nativePcmStopReason, PcmStartAttempt, supportsPcmLifecycle, type PcmLifecycleStream } from '../src/audio/pcmLifecycle';
import { SessionExpired } from '../src/auth/sessionManager';
import { LiveAnalysisPanel } from '../src/analysis/LiveAnalysisPanel';
import { newerAnalysis, type AnalysisSnapshot } from '../src/analysis/liveAnalysis';
import { subscribeAnalysis } from '../src/analysis/analysisSubscription';
import { PersistedResultPanel } from '../src/analysis/PersistedResultPanel';
import { saveMeetingView, readMeetingView, clearMeetingViews } from '../src/audio/meetingViewCache';
import { PendingRecordingPanel } from '../src/audio/PendingRecordingPanel';
import { NativePushSettings } from '../src/notifications/NativePushSettings';

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
  const [currentCapture, setCurrentCapture] = useState(false);
  const [background, setBackground] = useState(false);
  const [tab, setTab] = useState<'text' | 'summary' | 'decisions' | 'actions' | 'saved' | 'diagnostics'>('text');
  const [setup, setSetup] = useState(true);
  const backgroundActive = useRef(false);
  const captureStarted = useRef(false);
  const captureAttempt = useRef(new PcmStartAttempt());
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
  const lastPcmAt = useRef(0);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [history, setHistory] = useState<DiagnosticHistory | null>(null);
  const [historyFailure, setHistoryFailure] = useState(false);
  const [historyFailureCode, setHistoryFailureCode] = useState<DiagnosticFailureCode | undefined>();
  const historyHandle = useRef<DiagnosticHistory | null>(null);
  const authGeneration = useRef(0);
  const currentRun = useRef<string | undefined>(undefined);
  function closeHistory() {
    const previous = historyHandle.current;
    historyHandle.current = null;
    try { previous?.close(); } catch { /* Closed handles reject subsequent reads/writes. */ }
    setHistory(null);
    setHistoryFailure(false); setHistoryFailureCode(undefined);
  }
  async function prepareHistory(jwt: string, ownerGeneration: number) {
    if (Platform.OS === 'web') return;
    let opened: DiagnosticHistory | undefined;
    try {
      opened = await openAccountHistory(jwt, () => ownerGeneration === authGeneration.current) ?? undefined;
      if (!opened) return;
      if (ownerGeneration !== authGeneration.current) { opened.close(); return; }
      historyHandle.current = opened; setHistory(opened); setHistoryFailure(false); setHistoryFailureCode(undefined);
    } catch (error) {
      try { opened?.close(); } catch { /* fail closed */ }
      if (ownerGeneration === authGeneration.current) { setHistoryFailure(true); setHistoryFailureCode(diagnosticFailureCode(error)); }
    }
  }
  function record(kind: DiagnosticKind, details: Details = {}) {
    // The rendered handle is bound to this account. Logout closes old callback handles.
    try { history?.record(selected, kind, details); }
    catch { setHistoryFailure(true); } // Optional diagnostics must not interrupt capture or cleanup.
  }
  useEffect(() => () => {
    authGeneration.current++;
    const closing = historyHandle.current;
    historyHandle.current = null;
    void stopRef.current('Kayıt ekranından ayrılındı').finally(() => { try { closing?.close(); } catch { /* unmount */ } });
  }, []);
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
    const event = messageEvent(value);
    if (event) record(event.kind, event.details);
    setDiagnostics(previous => [...previous, `${new Date().toISOString()} | ${value}`].filter((_, index, all) => index < 3 || index >= all.length - 297));
  }
  function logTransport(connection: ForegroundStream | null) {
    if (!connection) { log('Ses taşıma bağlantısı oluşturulmadı.'); return; }
    const d = connection.diagnostics();
    record('transport', { ...d, runId: currentRun.current });
    log(`Ses: mikrofon tamponu=${d.capturedBuffers}, bayt=${d.capturedBytes}, üretilen parça=${d.generatedFrames}, gönderim denemesi=${d.sentFrames} (tekrarlar dahil), gateway onaylı=${d.acknowledgedFrames}, bekleyen=${d.pendingFrames ?? 'okunamadı'}, süresi dolan=${d.expiredFrames}, kapasite nedeniyle silinen=${d.evictedFrames}; son gönderilen sıra=${d.lastSentSeq}, son onay sırası=${d.lastAckSeq}`);
    log(`Son mikrofon=${d.lastCaptureUtc || 'yok'}; son gönderim=${d.lastSendUtc || 'yok'}; son gateway onayı=${d.lastAckUtc || 'yok'}; son metin=${d.lastTextUtc || 'yok'}; geçici metin olayı=${d.partialEvents}, kesin metin olayı=${d.finalEvents}`);
    log(`Ses sonu gönderimi=${d.eofUtc || 'yok'}; drained onayı=${d.drainedUtc || 'yok'}; WebSocket kapanış kodu=${d.closeCode || 'gözlenmedi'}; analiz sonucu sayısı=${analysisCount.current}. Gateway onayı STT/analiz tamamlandı anlamına gelmez.`);
  }
  function markStage(value: string) {
    stage.current = value;
    record('stage', { runId: currentRun.current, stage: diagnosticStage(value) });
    setStatus(value + '…');
    setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | ${value}`].filter((_, index, all) => index < 3 || index >= all.length - 297));
  }
  const { stream } = useAudioStream({ sampleRate: 16000, channels: 1, encoding: 'int16',
    onBuffer: (buffer) => {
      if (active.current && captureAttempt.current.acceptsBuffer(buffer as typeof buffer & { captureId?: string }, stream)) {
        lastPcmAt.current = Date.now();
        live.current?.send(buffer.data, buffer.sampleRate, buffer.channels, Date.now());
      }
    },
  });

  async function stop(reason = 'Belirtilmeyen durdurma çağrısı') {
    if (!active.current) return;
    const lifecycleStream: PcmLifecycleStream = stream;
    const nativeCaptureId = lifecycleStream.workcubeCaptureId;
    const readNativeFailure = () => {
      const terminal = backgroundStopReason(stream) || (supportsPcmLifecycle(stream) && nativeCaptureId &&
        lifecycleStream.workcubeCaptureId === nativeCaptureId ? lifecycleStream.workcubeLastStopReason : undefined);
      if (terminal && terminal !== 'requested' && terminal !== 'notification-stop') {
        failure.current ??= nativePcmStopReason({ isStreaming: false, reason: terminal });
      }
    };
    readNativeFailure();
    if (captureStarted.current && Date.now() - lastPcmAt.current > 10000) {
      failure.current ??= 'Mikrofondan 10 saniyedir ses verisi gelmedi; kayıt eksik olarak durduruldu.';
    }
    active.current = false;
    captureStarted.current = false;
    captureAttempt.current.clear();
    backgroundActive.current = false;
    clearInterval(diagnosticTimer.current);
    log(`Durdurma nedeni: ${reason}`);
    record('stop_requested', { runId: currentRun.current, sessionId: session.current,
      reason: reason.includes('bildiriminden') ? 'notification' : reason.startsWith('Kullanıcı') ? 'user' : reason.includes('arka plana') ? 'background'
        : reason.includes('ekranından') ? 'unmount' : reason.includes('veri akışı') ? 'pcm_gap' : reason.includes('başlatma') ? 'capture_start'
          : reason.includes('WebSocket') ? 'transport' : reason.includes('depolama') ? 'storage' : reason.includes('Başlatma') ? 'startup' : 'unknown' });
    try { stream.stop(); }
    catch { failure.current = 'Mikrofonun kapanışı doğrulanamadı; kayıt eksik olarak işaretlendi.'; }
    record('capture_stopped', { runId: currentRun.current, sessionId: session.current, microphoneOpen: !!stream.isStreaming, success: !failure.current && !stream.isStreaming });
    setRecording(false);
    setBusy(true);
    setStatus('Son sözler bekleniyor…');
    const connection = live.current;
    const id = session.current;
    if (id) api.captureStopped(id);
    let waitedForAnalysis = false;
    setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | Durdurma istendi`].filter((_, index, all) => index < 3 || index >= all.length - 297));
    live.current = null;
    session.current = null;
    try {
      let drained = false;
      try { drained = !!(await connection?.stop()); }
      catch { log('Ses akışının kapanışı doğrulanamadı; eksiksiz kapanış gönderilmeyecek.'); }
      log(`Ses akışı kapanış sonucu: ${drained ? 'drained doğrulandı' : 'drained doğrulanamadı'}`);
      readNativeFailure();
      let complete = !failure.current && !!drained && !!connection?.completionConfirmed();
      if (complete) {
        try { await audioBuffer.current?.confirmDrained(); }
        catch { complete = false; log('Kapanış kanıtı cihazda saklanamadı; kayıt eksik olarak korunuyor.'); }
      }
      if (id && token.current) { log('HTTP kayıt kapanışı başlatıldı'); const closed = await api.completeCapture(token.current.jwt, id, complete); log(closed ? 'HTTP kayıt kapanışı: FINISHED yanıtı doğrulandı' : 'Kayıt eksik; sunucuya tamamlandı gönderilmedi.'); }
      if (complete && !failure.current && stopAnalysis.current && !analysisReceived.current) {
        waitedForAnalysis = true;
        setStatus('Ses kaydı bitti; analiz sonucu en fazla 20 saniye bekleniyor…');
        setAnalysisStatus('Son metin parçaları işlendi; analiz sonucu bekleniyor.');
        await new Promise<void>(resolve => setTimeout(resolve, 20_000));
      }
      setStatus(failure.current ?? (complete ? 'Test bitti. Ekrandaki metni konuşmanızla karşılaştırabilirsiniz.' : 'Test durdu; son sözlerin tamamlandığı doğrulanamadı.'));
    } catch (error) { log(`Kapanış başarısız: ${error instanceof Error ? error.message : 'nedeni alınamadı'}`); setStatus(failure.current ?? 'Test durdu; sunucudaki kapanış doğrulanamadı.'); }
    finally {
      try { logTransport(connection); } catch { log('Ses tamponu sayaçları okunamadı; kapanış temizliği sürüyor.'); }
      log('Analiz aboneliği istemci tarafından kapatılıyor. Sunucu analiz tetikleme/işleme aşamaları telefon tarafından doğrulanamaz.');
      stopAnalysis.current?.(); stopAnalysis.current = null;
      generation.current++;
      if (!analysisReceived.current && !failure.current) {
        setAnalysisStatus('Canlı analiz sonucu gelmedi. Tanılama kaydındaki analiz aşamasını sunucu kaydıyla eşleştirin.');
        log(waitedForAnalysis ? 'Canlı analiz sonucu 20 saniyede gelmedi' : 'Eksik kapanış nedeniyle nihai analiz beklenmedi.');
      }
      if (failure.current) setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | ${failure.current}`].filter((_, index, all) => index < 3 || index >= all.length - 297));
      connection?.dispose();
      const bufferHandle = audioBuffer.current;
      if (bufferHandle) {
        try { log('Ses tamponu kapanışı: ' + await bufferHandle.release()); audioBuffer.current = null; }
        catch { log('Şifreli tampon temizliği tamamlanamadı; teslim veya silinme doğrulanmadı.'); }
      }
      void configureBackgroundCapture(false, stream).catch(() => {});
      setBusy(false);
    }
  }

  function confirmUserStop() {
    if (!recording || !active.current) return;
    log('Durdurma düğmesine dokunuldu; kullanıcı onayı bekleniyor');
    Alert.alert(
      'Kaydı bitir?',
      'Konuşma kaydı duracak ve son metin sunucuya gönderilecek.',
      [
        { text: 'Kayda devam et', style: 'cancel', onPress: () => log('Durdurma onayı iptal edildi; kayıt sürüyor') },
        { text: 'Kaydı bitir', style: 'destructive', onPress: () => void stop('Kullanıcı Durdur düğmesine dokundu ve onay penceresinde Kaydı bitir seçti') },
      ],
    );
  }

  const appStateRecord = useRef<(state: string) => void>(() => {});
  appStateRecord.current = state => {
    log(`Uygulama durumu=${state}; arka plan kaydı=${backgroundActive.current}`);
    if (state === 'active' || state === 'background' || state === 'inactive') record(`app_${state}`, { background: backgroundActive.current, runId: currentRun.current });
  };
  const stopRef = useRef(stop);
  useEffect(() => { stopRef.current = stop; });
  useEffect(() => {
    // Expo's web hook has no native PCM SharedObject.
    if (Platform.OS === 'web') return;
    const listener = stream.addListener?.('audioStreamStatus', (event) => {
      if (active.current && captureAttempt.current.acceptsStop(event, stream, captureStarted.current)) {
        const reason = backgroundStopReason(stream);
        if (reason === 'notification-stop') void stopRef.current('Kullanıcı kayıt bildiriminden durdurdu');
        else {
          failure.current = nativePcmStopReason(event);
          void stopRef.current(failure.current);
        }
      }
    });
    return () => listener?.remove();
  }, [stream]);
  useEffect(() => {
    const listener = listenBackgroundStop(stream, reason => {
      if (!active.current) return;
      if (reason !== 'notification-stop') failure.current = 'Arka plan kayıt hizmeti durdu; kaydın tamamlandığı doğrulanamadı.';
      void stopRef.current(reason === 'notification-stop' ? 'Kullanıcı kayıt bildiriminden durdurdu' : 'Arka plan kayıt hizmeti durdu');
    });
    return () => listener?.remove();
  }, [stream]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (active.current) {
        appStateRecord.current(state);
      }
      // The system permission dialog can temporarily deactivate the app.
      // No audio has started during this phase.
      // iOS inactive also means a system sheet/control center, not background.
      // Native interruption events carry the actual cause when audio is lost.
      if (state === 'background' && !permissionPending.current && !backgroundActive.current) {
        if (active.current) failure.current = 'Uygulama arka plana geçtiği için test durduruldu.';
        void stopRef.current('Uygulama arka plana geçti; arka plan kaydı etkin değil');
      }
    });
    return () => { listener.remove(); void stopRef.current('Kayıt ekranından ayrılındı'); };
  }, []);

  useEffect(() => {
    let mounted = true;
    const ownerGeneration = authGeneration.current;
    void (async () => {
      try {
        const restored = await api.restoreSession();
        if (!mounted || !restored || ownerGeneration !== authGeneration.current) return;
        await prepareHistory(restored.jwt, ownerGeneration);
        if (!mounted || ownerGeneration !== authGeneration.current) return;
        token.current = restored;
        setSignedIn(true);
        const meetings = await api.meetings(restored.jwt);
        if (mounted && ownerGeneration === authGeneration.current) { setList(meetings); setStatus('Oturumunuz açıldı. Bir toplantı seçin.'); }
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
            authGeneration.current++; closeHistory();
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
    record('session_closed');
    authGeneration.current++; closeHistory();
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
    const ownerGeneration = ++authGeneration.current;
    closeHistory();
    clearMeetingViews();
    token.current = null;
    setSignedIn(false);
    setList([]); setSelected(undefined); setLines([]); setAnalysis(null);
    stopAnalysis.current?.(); stopAnalysis.current = null;
    setBusy(true);
    setStatus('Giriş bekleniyor…');
    try {
      const nextSession = await api.login();
      if (ownerGeneration !== authGeneration.current) return;
      await prepareHistory(nextSession.jwt, ownerGeneration);
      if (ownerGeneration !== authGeneration.current) return;
      token.current = nextSession;
      setSignedIn(true);
      const nextMeetings = await api.meetings(token.current.jwt);
      if (ownerGeneration !== authGeneration.current) return;
      setList(nextMeetings);
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
    currentRun.current = undefined;
    try { history?.record(id, 'opened', { platform: Platform.OS, appVersion: Constants.expoConfig?.version }); }
    catch { setHistoryFailure(true); }
    stopAnalysis.current?.(); stopAnalysis.current = null;
    const cached = id ? readMeetingView(id) : undefined;
    setCurrentCapture(false);
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

  async function openSeparateMeeting() {
    if (active.current || busy || recording) throw new Error('Önce mevcut kaydı durdurun.');
    if (stream?.isStreaming) throw new Error('Mikrofon henüz kapanmadı. Kaydı durdurduktan sonra yeniden deneyin.');
    const ownerGeneration = authGeneration.current;
    setBusy(true);
    try {
      if (audioBuffer.current) { await audioBuffer.current.release(); audioBuffer.current = null; }
      const current = await api.validSession(30000);
      if (ownerGeneration !== authGeneration.current) throw new Error('Oturum değişti.');
      const meeting = await api.createMeeting(current.jwt, `Yeni toplantı ${new Date().toLocaleString('tr-TR')}`);
      if (ownerGeneration !== authGeneration.current) return;
      token.current = current;
      setList(previous => [meeting, ...previous.filter(item => item.id !== meeting.id)]);
      selectMeeting(meeting.id);
      setCurrentCapture(true); setTab('text'); setSetup(false);
      setStatus('Yeni toplantı hazır. Önceki kaydın kapanış bilgisi korunuyor. Konuşma testini başlatabilirsiniz.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Yeni toplantı açılamadı.');
      throw error;
    } finally { setBusy(false); }
  }

  async function start() {
    if (Platform.OS === 'web') { setStatus('Bu testi Android veya iOS uygulamasında açın.'); return; }
    if (active.current || !selected || !token.current) return;
    active.current = true;
    failure.current = null;
    analysisCount.current = 0;
    currentRun.current = undefined;
    setDiagnostics([]);
    const run = ++generation.current;
    setCurrentCapture(true);
    setTab('text');
    setBusy(true);
    setLines([]);
    setAnalysis(null);
    stage.current = 'Kayıt hazırlığı';
    try {
      try { currentRun.current = Crypto.randomUUID(); }
      catch { throw new Error('Kayıt hazırlığı tamamlanamadı. İnceleme kodu: START_ID. Yeniden deneyebilirsiniz.'); }
      setDiagnostics([`Mobil tanılama v3 | Deneme: ${currentRun.current} | UTC: ${new Date().toISOString()} | Toplantı: ${selected}`, 'Standart teknik rapor konuşma içeriği içermez. Uygulama zorla kapatılırsa son olay kaydedilemeyebilir.']);
      record('run_started', { runId: currentRun.current, background, platform: Platform.OS, appVersion: Constants.expoConfig?.version });
      markStage('Mikrofon izni');
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
      try { await configureBackgroundCapture(background, stream, () => generation.current === run && active.current); }
      finally { permissionPending.current = false; }
      if (generation.current !== run) return;
      if (['background'].includes(AppState.currentState)) throw new Error('Kaydı başlatmak için uygulamaya dönün.');
      const id = await api.begin(token.current.jwt, selected, markStage);
      if (generation.current !== run) { await api.completeCapture(token.current.jwt, id, true); return; }
      session.current = id;
      record('session', { runId: currentRun.current, sessionId: id });
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
      stopAnalysis.current = subscribeAnalysis({ baseUrl: api.BASE_URL, meetingId: selected,
        getToken: async () => {
          const refreshed = await api.validSession(30000);
          if (generation.current !== run) throw new SessionExpired();
          token.current = refreshed;
          return refreshed.jwt;
        },
        onDiagnostic: (message) => { if (generation.current === run) log(message); },
        onSnapshot: (snapshot) => {
          if (generation.current !== run) return;
          analysisCount.current++;
          record('analysis', { runId: currentRun.current, version: snapshot.version, partial: snapshot.partial, summaryCharacters: snapshot.summary.length, decisions: snapshot.decisions.length, actions: snapshot.actions.length, missingOwners: snapshot.actions.filter(action => !action.owner).length, microphoneOpen: captureStarted.current });
          log(`Analiz sonucu alındı: adet=${analysisCount.current}; sürüm=${snapshot.version}; taslak=${snapshot.partial}; özet karakteri=${snapshot.summary.length}; karar=${snapshot.decisions.length}; aksiyon=${snapshot.actions.length}; mikrofon açık=${captureStarted.current}`);
          analysisReceived.current = true;
          setAnalysisStatus('Canlı analiz sonucu alındı; yeni sonuçlar geldikçe güncellenecek.');
          setAnalysis((previous) => newerAnalysis(previous, snapshot));
        },
        onStatus: (message) => { if (generation.current === run) { setAnalysisStatus(message); setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | Analiz: ${message}`].filter((_, index, all) => index < 3 || index >= all.length - 297)); } },
      });
      const NativeWebSocket = WebSocket as unknown as new (url: string, protocols: string[] | undefined, options: { headers: Record<string, string> }) => LiveSocket;
      const socket = new NativeWebSocket(`${api.BASE_URL.replace('https:', 'wss:')}/api/v1/audio-gateway/sessions/${encodeURIComponent(id)}/stream`, undefined,
        { headers: { Authorization: `Bearer ${token.current.jwt}` } });
      live.current = new ForegroundStream(socket as unknown as LiveSocket, () => {
        if (generation.current !== run || !active.current) return;
        markStage('Sunucu hazır; mikrofon başlatılıyor');
        captureAttempt.current.request(stream);
        void startPcmCapture(stream, background).then(() => {
          if (generation.current !== run || !active.current) { stream.stop(); return; }
          if (stream.sampleRate !== 16000 || stream.channels !== 1) throw new Error('Desteklenmeyen mikrofon biçimi.');
          if (!stream.isStreaming) {
            failure.current = captureAttempt.current.stopReasonAfterStart(stream) ?? 'Mikrofon başlatılırken kayıt durdu; ayrıntılı neden alınamadı.';
            void stopRef.current(failure.current);
            return;
          }
          captureStarted.current = true;
          lastPcmAt.current = Date.now();
          backgroundActive.current = background;
          setRecording(true); setBusy(false); setStatus('Dinleniyor — konuşabilirsiniz. Bitirmek için Durdur düğmesine basın.');
          setDiagnostics((previous) => [...previous, `${new Date().toISOString()} | Mikrofon başladı`].filter((_, index, all) => index < 3 || index >= all.length - 297));
          log('Mikrofon açık; otomatik süre sınırı yok');
          record('capture_started', { runId: currentRun.current, sampleRate: stream.sampleRate, channels: stream.channels, background });
          diagnosticTimer.current = setInterval(() => {
            logTransport(live.current);
            if (active.current && captureStarted.current && Date.now() - lastPcmAt.current > 10000) {
              failure.current = 'Mikrofondan 10 saniyedir ses verisi gelmedi; kayıt eksik olarak durduruldu.';
              void stopRef.current('Mikrofon veri akışı kesildi');
            }
          }, 10000);
        }).catch(() => {
          if (generation.current !== run || !active.current) return;
          failure.current = 'Mikrofon başlatılamadı veya gerekli 16 kHz mono ses biçimi sağlanamadı.';
          void stopRef.current('Mikrofon başlatma hatası');
        });
      }, (line) => {
        if (generation.current !== run) return;
        if (line.final) record('transcript', { runId: currentRun.current, connection: line.connectionId, seq: line.seq, characters: line.text.length, periods: (line.text.match(/\./g) ?? []).length, questions: (line.text.match(/\?/g) ?? []).length, speakerTurns: line.speakerAttribution?.turns.length ?? 0 });
        setLines((previous) => applyTranscriptEvent({ lines: previous }, line.final
          ? { type: 'final', connectionId: line.connectionId, seq: line.seq, text: line.text, speakerAttribution: line.speakerAttribution }
          : { type: 'partial', connectionId: line.connectionId, seq: line.seq, confirmed: line.confirmed ?? '', tentative: line.tentative ?? line.text }).lines);
      }, (message) => { if (generation.current !== run) return; record('capture_failed', { runId: currentRun.current }); log(`Ses bağlantısı hatası: ${message}`); failure.current = message; setStatus(message); void stopRef.current('Ses aktarımı veya WebSocket hatası'); },
      preparedBuffer.buffer, {
        onConnectionInterrupted: (connectionId) => {
          if (generation.current !== run) return;
          record('transcript_connection_closed', { runId: currentRun.current, connection: connectionId });
          setLines(previous => applyTranscriptEvent({ lines: previous }, { type: 'connection_interrupted', connectionId }).lines);
        },
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

  const header = <View style={{ gap: 12 }}>
    <Text style={styles.title}>Toplantı</Text>
    <Text style={styles.text}>{status}</Text>
    {signedIn && !recording && !busy && <PendingRecordingPanel key={selected} meetingId={selected} onSeparateMeeting={openSeparateMeeting} beforeResolve={async () => {
      if (audioBuffer.current) { await audioBuffer.current.release(); audioBuffer.current = null; }
    }} />}
    <Pressable accessibilityRole="button" onPress={() => setSetup(!setup)}><Text style={styles.selected}>{setup ? 'Toplantı ayarlarını gizle' : 'Toplantı seç / ayarlar'}</Text></Pressable>
    {setup && <View>
    <Text style={styles.note}>{background ? `Arka planda kayıt açık. Kaydı uygulamadan${Platform.OS === 'android' ? ' veya kayıt bildiriminden' : ''} durdurabilirsiniz. Otomatik süre sınırı yoktur.` : 'Bu kısa denemede ekran açık kalmalıdır.'} Kısa ağ kesintisinde yeniden bağlanmayı dener; düzelmezse test durur.</Text>
    {supportsBackgroundCapture(stream) && <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={styles.note}>Ekran kapalıyken kayda devam et</Text>
      <Switch accessibilityLabel="Arka planda kayıt" value={background} disabled={busy || recording} onValueChange={setBackground} />
    </View>}
    {(Platform.OS === 'android' || Platform.OS === 'ios') && !supportsBackgroundCapture(stream) && <Text style={styles.note}>Arka plan kaydı bu uygulama sürümünde hazır değil. Uygulama ekran açıkken kayıt yapabilir.</Text>}
    <View style={{ gap: 8 }}>
    <Pressable accessibilityState={{ disabled: busy || recording }} disabled={busy || recording} style={[styles.button, (busy || recording) && styles.disabled]} onPress={() => void signIn()}><Text style={styles.text}>Giriş yap</Text></Pressable>
    <Pressable disabled={busy || recording} style={[styles.button, (busy || recording) && styles.disabled]} onPress={() => void signOut()}><Text style={styles.text}>Çıkış yap</Text></Pressable>
    <View>
      {signedIn && <>
        <NativePushSettings disabled={busy || recording} />
        <NewMeetingForm disabled={busy || recording} onCreate={createMeeting} />
        <Pressable accessibilityRole="button" disabled={busy || recording} onPress={() => void refreshMeetings()}><Text style={styles.text}>Listeyi yenile</Text></Pressable>
      </>}
      {list.map((meeting) => <Pressable key={meeting.id} disabled={busy || recording} onPress={() => selectMeeting(meeting.id)}>
        <Text style={[styles.text, selected === meeting.id && styles.selected]}>{selected === meeting.id ? '✓ ' : ''}{meeting.title}</Text>
      </Pressable>)}
    </View></View></View>}
    <Pressable accessibilityState={{ disabled: !selected || busy || recording }} disabled={!selected || busy || recording} style={[styles.button, (!selected || busy || recording) && styles.disabled]} onPress={() => Alert.alert('Konuşma testi', api.CONSENT,
      [{ text: 'Vazgeç' }, { text: 'Kabul et ve başlat', onPress: () => { setSetup(false); setTab('text'); void start(); } }])}><Text style={styles.text}>Konuşma testini başlat</Text></Pressable>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {([['text', 'Metin'], ['summary', 'Özet'], ['decisions', 'Kararlar'], ['actions', 'Aksiyonlar'], ['saved', 'Kaydedilen'], ['diagnostics', 'Tanılama']] as const).map(([key, label]) =>
        <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={{ padding: 8, borderBottomWidth: 2, borderBottomColor: tab === key ? '#93c5fd' : 'transparent' }}><Text style={styles.text}>{label}</Text></Pressable>)}
    </View>
  </View>;
  const canReadSaved = signedIn && !!selected && !recording && !busy && !currentCapture;
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.page}>
    {recording && <View testID="recording-controls">
      <Text accessibilityRole="alert" style={styles.recording}>● Mikrofon açık · Kayıt sürüyor</Text>
      <Pressable accessibilityRole="button" style={styles.button} onPress={confirmUserStop}><Text style={styles.text}>Durdur</Text></Pressable>
    </View>}
    {tab === 'text' && <View style={{ flex: 1 }}>{signedIn && selected && !recording && !busy && !currentCapture
      ? <SavedTranscript meetingId={selected} header={header} />
      : <TranscriptView lines={lines} header={header} />}</View>}
    {tab !== 'text' && <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      {header}
      {tab === 'saved' && signedIn && selected && !recording && !busy && <PersistedResultPanel key={selected} meetingId={selected} onDiagnostic={log} />}
      {tab === 'saved' && (!signedIn || !selected || recording || busy) && <Text style={styles.note}>Kaydı durdurup bir toplantı seçtikten sonra kalıcı sonucu açabilirsiniz.</Text>}
      {(tab === 'summary' || tab === 'decisions' || tab === 'actions') && (canReadSaved && selected
        ? <PersistedResultPanel meetingId={selected} onDiagnostic={log} section={tab} />
        : <>
          <LiveAnalysisPanel snapshot={analysis} status={analysisStatus} section={tab} />
          {signedIn && selected && !recording && !busy && <Pressable accessibilityRole="button" onPress={() => setTab('saved')}>
            <Text style={styles.selected}>Kaydedilmiş sonucu kontrol et</Text>
          </Pressable>}
        </>)}
      {tab === 'diagnostics' && <View>
        <HistoryPanel history={history} meetingId={selected} failure={historyFailure} failureCode={historyFailureCode} />
        <Text style={styles.text}>Tanılama kaydı (bu deneme)</Text>
        <Text selectable style={styles.note}>{diagnostics.join('\n')}</Text>
        <Pressable style={styles.button} onPress={() => {
          try { const storedOrTemporary = history && selected ? history.report(selected) :
            [historyFailureCode ? `Kalıcı tanılama inceleme kodu: ${historyFailureCode}` : '', ...diagnostics].filter(Boolean).join('\n');
            const message = storedOrTemporary;
            void Share.share({ message }).catch(() => setStatus('Paylaşım açılamadı; tanılama metnini seçip kopyalayabilirsiniz.'));
          } catch { setStatus('Saklanan tanılama geçmişi okunamadı.'); }
        }}>
          <Text style={styles.text}>Tanılama kaydını paylaş</Text>
        </Pressable>
      </View>}
    </ScrollView>}
  </SafeAreaView>;
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
