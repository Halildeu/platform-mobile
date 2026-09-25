import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, AppState, Platform, Share } from 'react-native';
import * as Crypto from 'expo-crypto';
import LiveTestScreen from '../../../app/live-test';
import * as api from '../liveTestApi';
import { clearMeetingViews, saveMeetingView } from '../meetingViewCache';
import type { LiveText } from '../foregroundStream';
import type { AnalysisSnapshot } from '../../analysis/liveAnalysis';
import { DiagnosticHistory, type Entry } from '../../diagnostics/history';
import { openAccountHistory } from '../../diagnostics/openAccountHistory';
import { DiagnosticOpenError } from '../../diagnostics/openFailure';
jest.mock('../../diagnostics/openAccountHistory', () => ({ openAccountHistory: jest.fn() }));

const mockStart = jest.fn().mockResolvedValue(undefined);
const mockStop = jest.fn();
let mockWebStream = false;
let mockStatusListener: (event: { isStreaming: boolean; captureId?: string; reason?: string }) => void;
let mockBuffer: (buffer: { data: ArrayBuffer; sampleRate: number; channels: number }) => void;
const mockStream = {
  start: mockStart, stop: mockStop, sampleRate: 16000, channels: 1, isStreaming: true,
  workcubeCaptureId: '', workcubeLastStopReason: '', workcubePcmLifecycleVersion: 0, configureBackgroundCapture: jest.fn(),
  addListener: jest.fn((_name, listener) => { mockStatusListener = listener; return { remove: jest.fn() }; }),
};
const mockPermission = jest.fn();
const mockDrain = jest.fn();
let mockFailure: (message: string) => void;
let mockReady: () => void;
let mockText: (line: LiveText) => void;
let mockAnalysis: (snapshot: AnalysisSnapshot) => void;
let mockAnalysisDiagnostic: ((message: string) => void) | undefined;
let mockParams: { notificationMeetingId?: string } = {};
jest.mock('expo-audio', () => ({
  AudioModule: { requestRecordingPermissionsAsync: (...args: unknown[]) => mockPermission(...args) },
  useAudioStream: (options: { onBuffer: typeof mockBuffer }) => { mockBuffer = options.onBuffer; return { stream: mockWebStream ? null : mockStream }; },
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
let mockBackgroundStop: (reason: string) => void;
let mockBackgroundReason: string | undefined;
jest.mock('../backgroundCapture', () => ({ supportsBackgroundCapture: () => false, configureBackgroundCapture: jest.fn(async () => {}),
  startPcmCapture: () => mockStart(), backgroundStopReason: () => mockBackgroundReason,
  listenBackgroundStop: (_stream: unknown, callback: (reason: string) => void) => { mockBackgroundStop = callback; return { remove: jest.fn() }; },
}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('../../auth/mobileSession', () => ({ mobileSession: { contentScope: () => 1, snapshot: () => null } }));
jest.mock('../liveTestApi', () => ({
  login: jest.fn(), meetings: jest.fn(), begin: jest.fn(), finish: jest.fn(), completeCapture: jest.fn(), captureStopped: jest.fn(), pendingRecording: jest.fn(async () => null), abandonRecording: jest.fn(), createMeeting: jest.fn(),
  lifecycleOwner: jest.fn(), restoreSession: jest.fn(), validSession: jest.fn(), logout: jest.fn(), persistedResult: jest.fn(), savedTranscript: jest.fn(),
  BASE_URL: 'https://example.test', CONSENT: 'Test onayı',
}));
jest.mock('../../analysis/analysisSubscription', () => ({ subscribeAnalysis: (options: { onSnapshot: typeof mockAnalysis; onDiagnostic?: (message: string) => void }) => {
  mockAnalysis = options.onSnapshot;
  mockAnalysisDiagnostic = options.onDiagnostic;
  return () => options.onDiagnostic?.('Canlı analiz akışı: bağlantı=1, bayt=413, heartbeat=1, geçerli=1');
} }));
jest.mock('../foregroundStream', () => ({ ForegroundStream: jest.fn().mockImplementation(
  (_socket, _ready, _text, failure) => {
    mockFailure = failure;
    mockReady = _ready;
    mockText = _text;
    return { send: jest.fn(), stop: mockDrain, dispose: jest.fn(), completionConfirmed: () => true, diagnostics: () => ({}) };
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(api.pendingRecording).mockResolvedValue(null);
  jest.mocked(api.lifecycleOwner).mockRejectedValue(new Error('Fixture has no stable account'));
  jest.mocked(openAccountHistory).mockReset();
  jest.mocked(openAccountHistory).mockResolvedValue(null);
  clearMeetingViews();
  mockParams = {};
  mockWebStream = false;
  mockBackgroundReason = undefined;
  Object.assign(mockStream, { isStreaming: true, workcubeCaptureId: '', workcubeLastStopReason: '', workcubePcmLifecycleVersion: 0 });
  mockStart.mockResolvedValue(undefined);
  mockDrain.mockResolvedValue(false);
  jest.mocked(api.login).mockResolvedValue({ jwt: 'test-only', expiresAt: Date.now() + 600000 });
  jest.mocked(api.validSession).mockResolvedValue({ jwt: 'test-only', expiresAt: Date.now() + 600000 });
  jest.mocked(api.restoreSession).mockResolvedValue(null);
  jest.mocked(api.logout).mockResolvedValue(true);
  jest.mocked(api.meetings).mockResolvedValue([{ id: 'meeting-1', title: 'Test toplantısı' }]);
  jest.mocked(api.begin).mockResolvedValue('session-1');
  jest.mocked(api.completeCapture).mockResolvedValue(true);
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});
afterEach(() => jest.restoreAllMocks());

it('opens the web preview when Expo exposes no native PCM stream', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  mockWebStream = true;
  const screen = render(<LiveTestScreen />);
  await act(async () => {});
  expect(screen.getByText('Giriş yap')).toBeTruthy();
  expect(mockStream.addListener).not.toHaveBeenCalled();
  screen.unmount();
});

async function openAndStart() {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<LiveTestScreen />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Giriş yap'));
  await waitFor(() => expect(screen.getByText('Test toplantısı')).toBeTruthy());
  fireEvent.press(screen.getByText('Test toplantısı'));
  fireEvent.press(screen.getByText('Konuşma testini başlat'));
  await act(async () => { alert.mock.calls[0][2]?.[1].onPress?.(); });
  return screen;
}

it('preserves validated speaker attribution through the actual live screen callback', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  const screen = await openAndStart();
  await act(async () => { mockText({ seq: 0, text: 'Merhaba', final: true, speakerAttribution: {
    scope: '12345678-1234-3234-8234-123456789012',
    turns: [{ speaker: 'S1', textStart: 0, textEnd: 7, startMs: 0, endMs: 1000 }],
  } }); });
  expect(screen.getByText(/speakerNotice|kişi adı veya kimlik/)).toBeTruthy();
  expect(screen.getByText(/Merhaba/)).toBeTruthy();
  screen.unmount();
});

it('does not cancel startup when the permission dialog temporarily deactivates the app', async () => {
  let resolvePermission!: (value: { granted: boolean }) => void;
  mockPermission.mockReturnValue(new Promise((resolve) => { resolvePermission = resolve; }));
  const listener = jest.spyOn(AppState, 'addEventListener');
  await openAndStart();
  await waitFor(() => expect(mockPermission).toHaveBeenCalled());
  act(() => { listener.mock.calls[0][1]('inactive'); });
  expect(mockStop).not.toHaveBeenCalled();
  expect(api.begin).not.toHaveBeenCalled();
  await act(async () => { resolvePermission({ granted: true }); });
  expect(api.begin).toHaveBeenCalledTimes(1);
}, 20000);

it('keeps the connection failure visible after asynchronous cleanup', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  const screen = await openAndStart();
  await waitFor(() => expect(api.begin).toHaveBeenCalled());
  await act(async () => { mockFailure('Ses sunucusu hazır olmadı.'); });
  expect(screen.getByText('Ses sunucusu hazır olmadı.')).toBeTruthy();
  expect(screen.queryByText('Test durdu; son sözlerin tamamlandığı doğrulanamadı.')).toBeNull();
});

it('never confirms a damaged native capture even when earlier audio drains successfully', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  mockDrain.mockResolvedValue(true);
  const screen = await openAndStart();
  await act(async () => { mockReady(); });
  await act(async () => { mockStatusListener({ isStreaming: false, reason: 'conversion-failed' }); });
  expect(api.completeCapture).toHaveBeenCalledWith('test-only', 'session-1', false);
  expect(screen.getByText('Mikrofon sesi gerekli biçime dönüştürülemedi; kayıt durduruldu.')).toBeTruthy();
  expect(screen.queryByText('Test bitti. Ekrandaki metni konuşmanızla karşılaştırabilirsiniz.')).toBeNull();
});

it('reads a native failure even before its status event is delivered', async () => {
  mockPermission.mockResolvedValue({ granted: true }); mockDrain.mockResolvedValue(true);
  const screen = await openAndStart();
  await act(async () => { mockReady(); });
  Object.assign(mockStream, { workcubePcmLifecycleVersion: 1, workcubeCaptureId: 'capture-current',
    workcubeLastStopReason: 'conversion-failed', isStreaming: false });
  fireEvent.press(screen.getByText('Durdur'));
  await act(async () => { jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(api.completeCapture).toHaveBeenCalledWith('test-only', 'session-1', false);
  expect(screen.getByText('Mikrofon sesi gerekli biçime dönüştürülemedi; kayıt durduruldu.')).toBeTruthy();
});

it('fails incomplete when PCM stops arriving even though the native stream still reports running', async () => {
  mockPermission.mockResolvedValue({ granted: true }); mockDrain.mockResolvedValue(true);
  const screen = await openAndStart();
  jest.useFakeTimers();
  try {
    await act(async () => { mockReady(); });
    await act(async () => { jest.advanceTimersByTime(20000); });
    expect(api.completeCapture).toHaveBeenCalledWith('test-only', 'session-1', false);
    expect(screen.getByText('Mikrofondan 10 saniyedir ses verisi gelmedi; kayıt eksik olarak durduruldu.')).toBeTruthy();
  } finally { jest.useRealTimers(); }
});

it('honors native notification stop without treating the user action as an audio failure', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  mockDrain.mockResolvedValue(true);
  const screen = await openAndStart();
  await act(async () => { mockReady(); });
  await act(async () => { mockAnalysis({ version: 1, partial: true, summary: '', decisions: [], actions: [] }); });
  mockBackgroundReason = 'notification-stop';
  await act(async () => {
    mockStatusListener({ isStreaming: false });
    mockBackgroundStop('notification-stop');
  });
  expect(api.completeCapture).toHaveBeenCalledTimes(1);
  expect(api.completeCapture).toHaveBeenCalledWith('test-only', 'session-1', true);
  expect(screen.getByText('Test bitti. Ekrandaki metni konuşmanızla karşılaştırabilirsiniz.')).toBeTruthy();
});

it('still closes the connection as incomplete if stopping the microphone throws', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  mockDrain.mockResolvedValue(true);
  const screen = await openAndStart();
  await act(async () => { mockReady(); });
  mockStop.mockImplementationOnce(() => { throw new Error('native stop failed'); });
  fireEvent.press(screen.getByText('Durdur'));
  await act(async () => { jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(api.completeCapture).toHaveBeenCalledWith('test-only', 'session-1', false);
  expect(screen.getByText('Mikrofonun kapanışı doğrulanamadı; kayıt eksik olarak işaretlendi.')).toBeTruthy();
});

it('does not show successful stop when finish validation fails after a drained stream', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  mockDrain.mockResolvedValue(true);
  jest.mocked(api.completeCapture).mockRejectedValueOnce(new Error('Kayıt kapanışı doğrulanamadı.'));
  const screen = await openAndStart();
  await waitFor(() => expect(api.begin).toHaveBeenCalled());
  await act(async () => { mockReady(); });
  await act(async () => { fireEvent.press(screen.getByText('Durdur')); });
  const stopAlert = jest.mocked(Alert.alert).mock.calls.at(-1);
  expect(stopAlert?.[0]).toBe('Kaydı bitir?');
  expect(api.completeCapture).not.toHaveBeenCalled();
  await act(async () => { stopAlert?.[2]?.[1].onPress?.(); });
  expect(api.completeCapture).toHaveBeenCalledWith('test-only', 'session-1', true);
  expect(screen.getByText('Test durdu; sunucudaki kapanış doğrulanamadı.')).toBeTruthy();
  expect(screen.queryByText('Test bitti. Ekrandaki metni konuşmanızla karşılaştırabilirsiniz.')).toBeNull();
  fireEvent.press(screen.getByText('Tanılama'));
  expect(screen.getByText(/Durdurma nedeni: Kullanıcı Durdur düğmesine dokundu ve onay penceresinde Kaydı bitir seçti/)).toBeTruthy();
});

it('keeps recording when stop confirmation is cancelled', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  const screen = await openAndStart();
  await waitFor(() => expect(api.begin).toHaveBeenCalled());
  await act(async () => { mockReady(); });
  fireEvent.press(screen.getByText('Durdur'));
  const stopAlert = jest.mocked(Alert.alert).mock.calls.at(-1);
  await act(async () => { stopAlert?.[2]?.[0].onPress?.(); });
  expect(mockStop).not.toHaveBeenCalled();
  expect(mockDrain).not.toHaveBeenCalled();
  expect(api.completeCapture).not.toHaveBeenCalled();
  expect(screen.getByText('● Mikrofon açık · Kayıt sürüyor')).toBeTruthy();
  await act(async () => { mockFailure('Kontrollü test kapanışı'); });
});

it('keeps recording beyond the former 60 second limit', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  const screen = await openAndStart();
  await waitFor(() => expect(api.begin).toHaveBeenCalled());
  jest.useFakeTimers();
  try {
    await act(async () => { mockReady(); });
    await act(async () => {
      for (let i = 0; i < 120; i++) {
        mockBuffer({ data: new ArrayBuffer(3200), sampleRate: 16000, channels: 1 });
        jest.advanceTimersByTime(1000);
      }
    });
    expect(mockStop).not.toHaveBeenCalled();
    expect(mockDrain).not.toHaveBeenCalled();
    expect(screen.getByText('Dinleniyor — konuşabilirsiniz. Bitirmek için Durdur düğmesine basın.')).toBeTruthy();
    await act(async () => { mockFailure('Kontrollü test kapanışı'); });
  } finally { jest.useRealTimers(); }
});

it('restores meetings without interactive login and clears them on logout', async () => {
  jest.mocked(api.restoreSession).mockResolvedValueOnce({ jwt: 'restored', expiresAt: Date.now() + 300000 });
  const screen = render(<LiveTestScreen />);
  await waitFor(() => expect(screen.getByText('Test toplantısı')).toBeTruthy());
  expect(api.login).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Çıkış yap'));
  await waitFor(() => expect(screen.getByText('Uygulamadan çıkış yapıldı.')).toBeTruthy());
  expect(screen.queryByText('Test toplantısı')).toBeNull();
  expect(api.logout).toHaveBeenCalledTimes(1);
});

it('creates and selects a new meeting without starting the microphone', async () => {
  jest.mocked(api.restoreSession).mockResolvedValueOnce({ jwt: 'restored', expiresAt: Date.now() + 300000 });
  jest.mocked(api.createMeeting).mockResolvedValueOnce({ id: 'new-meeting', title: 'Yeni görüşme' });
  const screen = render(<LiveTestScreen />);
  await waitFor(() => expect(screen.getByText('Test toplantısı')).toBeTruthy());
  fireEvent.press(screen.getByText('Yeni toplantı oluştur'));
  fireEvent.changeText(screen.getByLabelText('Yeni toplantı adı'), 'Yeni görüşme');
  fireEvent.press(screen.getByText('Toplantıyı oluştur'));
  await waitFor(() => expect(screen.getByText('✓ Yeni görüşme')).toBeTruthy());
  expect(api.createMeeting).toHaveBeenCalledWith('test-only', 'Yeni görüşme');
  expect(mockStart).not.toHaveBeenCalled(); expect(api.begin).not.toHaveBeenCalled();
});

it('starts an ordinarily created meeting with normal consent while the old meeting receipt remains visible', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(api.restoreSession).mockResolvedValueOnce({ jwt: 'restored', expiresAt: Date.now() + 300000 });
  jest.mocked(api.pendingRecording).mockResolvedValue({ meetingId: 'meeting-1', sessionId: 'SES-old', incomplete: true, abandoning: false });
  jest.mocked(api.createMeeting).mockResolvedValueOnce({ id: 'new-meeting', title: 'Yeni görüşme' });
  mockPermission.mockResolvedValue({ granted: true });
  const screen = render(<LiveTestScreen />);
  await waitFor(() => expect(screen.getByText('Test toplantısı')).toBeTruthy());
  fireEvent.press(screen.getByText('Yeni toplantı oluştur'));
  fireEvent.changeText(screen.getByLabelText('Yeni toplantı adı'), 'Yeni görüşme');
  fireEvent.press(screen.getByText('Toplantıyı oluştur'));
  await waitFor(() => expect(screen.getByText('✓ Yeni görüşme')).toBeTruthy());
  await waitFor(() => expect(screen.getByText(/Seçili toplantıda Konuşma testini başlat/)).toBeTruthy());
  expect(screen.queryByText('Önceki kaydı koru, yeni toplantı aç')).toBeNull();
  expect(api.begin).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Konuşma testini başlat'));
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(api.begin).toHaveBeenCalledWith('test-only', 'new-meeting', expect.any(Function));
  expect(api.createMeeting).toHaveBeenCalledTimes(1);
  expect(api.abandonRecording).not.toHaveBeenCalled();
  await act(async () => mockReady());
  expect(screen.getByText('● Mikrofon açık · Kayıt sürüyor')).toBeTruthy();
  await act(async () => mockFailure('Kontrollü test kapanışı'));
  await act(async () => screen.unmount());
});

it('opens an authorized notification meeting only after session restoration without starting audio', async () => {
  mockParams = { notificationMeetingId: 'meeting-1' };
  jest.mocked(api.restoreSession).mockResolvedValueOnce({ jwt: 'restored', expiresAt: Date.now() + 300000 });
  const screen = render(<LiveTestScreen />);
  await waitFor(() => expect(screen.getByText('✓ Test toplantısı')).toBeTruthy());
  expect(screen.getByText('Bildirimdeki toplantı seçildi; kayıtlı sonuç kontrol ediliyor.')).toBeTruthy();
  expect(api.begin).not.toHaveBeenCalled();
  expect(mockStart).not.toHaveBeenCalled();
  screen.rerender(<LiveTestScreen />);
  expect(screen.getByText('✓ Test toplantısı')).toBeTruthy();
});

it('keeps a notification gated until login and rejects a meeting absent from the authorized list', async () => {
  mockParams = { notificationMeetingId: 'foreign-meeting' };
  const screen = render(<LiveTestScreen />);
  await act(async () => {});
  expect(api.meetings).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Giriş yap'));
  await waitFor(() => expect(screen.getByText(/Bildirimdeki toplantı mevcut listede bulunamadı/)).toBeTruthy());
  expect(screen.queryByText('✓ Test toplantısı')).toBeNull();
  expect(api.begin).not.toHaveBeenCalled();
});

it('defers a different notification meeting while recording and applies it after cleanup', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  jest.mocked(api.meetings).mockResolvedValue([
    { id: 'meeting-1', title: 'Test toplantısı' }, { id: 'meeting-2', title: 'İkinci toplantı' },
  ]);
  const screen = await openAndStart();
  await waitFor(() => expect(api.begin).toHaveBeenCalled());
  mockParams = { notificationMeetingId: 'meeting-2' };
  screen.rerender(<LiveTestScreen />);
  fireEvent.press(screen.getByText('Toplantı seç / ayarlar'));
  expect(screen.getByText('✓ Test toplantısı')).toBeTruthy();
  expect(mockStop).not.toHaveBeenCalled();
  await act(async () => { mockFailure('Kontrollü test kapanışı'); });
  await waitFor(() => expect(screen.getByText('✓ İkinci toplantı')).toBeTruthy());
  expect(api.begin).toHaveBeenCalledTimes(1);
});

it('restores canonical full text in Metin even when a partial navigation cache exists', async () => {
  saveMeetingView('meeting-1', { lines: [{ seq: 1, text: 'PARTIAL_CACHE', confirmed: 'PARTIAL_CACHE', tentative: '', status: 'final' }], analysis: null, diagnostics: [] });
  jest.mocked(api.restoreSession).mockResolvedValue({ jwt: 'test-only', expiresAt: Date.now() + 600000 });
  jest.mocked(api.persistedResult).mockResolvedValue({ analysisRunId: 'run-1', meetingId: 'meeting-1', sessionId: 'session-1', generatedAt: '2026-09-18T10:00:00Z', summary: '', decisions: [], actions: [], sources: [] });
  jest.mocked(api.savedTranscript).mockResolvedValue({ meetingId: 'meeting-1', analysisRunId: 'run-1', text: 'FULL_SAVED_TRANSCRIPT' });
  const screen = render(<LiveTestScreen />);
  await waitFor(() => expect(screen.getByText('Test toplantısı')).toBeTruthy());
  fireEvent.press(screen.getByText('Test toplantısı'));
  fireEvent.press(screen.getByText('Metin'));
  await waitFor(() => expect(screen.getByText('FULL_SAVED_TRANSCRIPT')).toBeTruthy());
  expect(screen.queryByText('PARTIAL_CACHE')).toBeNull();
  expect(api.savedTranscript).toHaveBeenCalledWith('meeting-1', 'run-1');
  await act(async () => fireEvent.press(screen.getByText('Çıkış yap')));
  expect(screen.queryByText('FULL_SAVED_TRANSCRIPT')).toBeNull();
});

it('does not misclassify an inactive system sheet as background or a user stop', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  const listener = jest.spyOn(AppState, 'addEventListener');
  const screen = await openAndStart();
  await waitFor(() => expect(api.begin).toHaveBeenCalled());
  await act(async () => mockReady());
  act(() => listener.mock.calls[0][1]('inactive'));
  expect(mockStop).not.toHaveBeenCalled();
  expect(screen.getByText('● Mikrofon açık · Kayıt sürüyor')).toBeTruthy();
  await act(async () => listener.mock.calls[0][1]('background'));
  expect(api.completeCapture).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Uygulama arka plana geçtiği için test durduruldu.')).toBeTruthy();
});

it('preserves a native interruption before start resolves and finishes the server session once', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  mockStream.workcubePcmLifecycleVersion = 1;
  mockStream.workcubeCaptureId = 'previous-capture';
  let resolveStart!: () => void;
  mockStart.mockImplementationOnce(() => {
    mockStream.workcubeCaptureId = 'current-capture';
    return new Promise<void>(resolve => { resolveStart = resolve; });
  });
  const screen = await openAndStart();
  await waitFor(() => expect(api.begin).toHaveBeenCalled());
  act(() => mockReady());
  await act(async () => {
    mockStream.isStreaming = false;
    mockStatusListener({ isStreaming: false, captureId: 'current-capture', reason: 'audio-interruption' });
  });
  expect(api.completeCapture).toHaveBeenCalledTimes(1);
  await act(async () => resolveStart());
  expect(screen.getByText(/iOS ses kaydını bir çağrı/)).toBeTruthy();
  expect(screen.queryByText('● Mikrofon açık · Kayıt sürüyor')).toBeNull();
  fireEvent.press(screen.getByText('Tanılama'));
  expect(screen.getByText(/Durdurma nedeni: iOS ses kaydını bir çağrı/)).toBeTruthy();
});

it('ignores a delayed old native stop while the new capture is active', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  mockStream.workcubePcmLifecycleVersion = 1;
  mockStream.workcubeCaptureId = 'previous-capture';
  mockStart.mockImplementationOnce(async () => { mockStream.workcubeCaptureId = 'current-capture'; });
  const screen = await openAndStart();
  await waitFor(() => expect(api.begin).toHaveBeenCalled());
  await act(async () => mockReady());
  act(() => mockStatusListener({ isStreaming: false, captureId: 'previous-capture', reason: 'media-services-reset' }));
  expect(mockStop).not.toHaveBeenCalled();
  expect(api.completeCapture).not.toHaveBeenCalled();
  expect(screen.getByText('● Mikrofon açık · Kayıt sürüyor')).toBeTruthy();
  await act(async () => {
    mockStream.isStreaming = false;
    mockStatusListener({ isStreaming: false, captureId: 'current-capture', reason: 'input-route-lost' });
  });
  expect(api.completeCapture).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Kullanılan mikrofon veya kulaklık bağlantısı kesildi/)).toBeTruthy();
});

it('does not show microphone running if native start resolves after stopping without a status event', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  mockStart.mockImplementationOnce(async () => { mockStream.isStreaming = false; });
  const screen = await openAndStart();
  await waitFor(() => expect(api.begin).toHaveBeenCalled());
  await act(async () => mockReady());
  expect(screen.queryByText('● Mikrofon açık · Kayıt sürüyor')).toBeNull();
  expect(api.completeCapture).toHaveBeenCalledTimes(1);
});

it('retains native reason when start resolves before the queued terminal event', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  mockStream.workcubePcmLifecycleVersion = 1;
  mockStream.workcubeCaptureId = 'previous-capture';
  mockStart.mockImplementationOnce(async () => {
    mockStream.workcubeCaptureId = 'current-capture';
    mockStream.workcubeLastStopReason = 'media-services-reset';
    mockStream.isStreaming = false;
  });
  const screen = await openAndStart();
  await waitFor(() => expect(api.begin).toHaveBeenCalled());
  await act(async () => mockReady());
  expect(api.completeCapture).toHaveBeenCalledTimes(1);
  expect(screen.getByText('iOS ses servisi yeniden başlatıldı; mikrofon durduruldu.')).toBeTruthy();
  await act(async () => mockStatusListener({ isStreaming: false, captureId: 'current-capture', reason: 'media-services-reset' }));
  expect(api.completeCapture).toHaveBeenCalledTimes(1);
});

it('incomplete stop records local stop and never waits for a final analysis', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  const screen = await openAndStart(); await waitFor(() => expect(api.begin).toHaveBeenCalled());
  await act(async () => { mockReady(); });
  fireEvent.press(screen.getByText('Durdur'));
  await act(async () => { jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  expect(api.captureStopped).toHaveBeenCalledWith('session-1');
  expect(api.completeCapture).toHaveBeenCalledWith('test-only', 'session-1', false);
  expect(screen.getByText('Test durdu; son sözlerin tamamlandığı doğrulanamadı.')).toBeTruthy();
  fireEvent.press(screen.getByText('Tanılama'));
  expect(screen.queryByText(/Canlı analiz sonucu 20 saniyede gelmedi/)).toBeNull();
});

it('shows the reopened meeting server result in each analysis tab, replacing an old live cache', async () => {
  saveMeetingView('meeting-1', { lines: [], diagnostics: [], analysis: { version: 1, partial: true, summary: 'OLD_LIVE', decisions: [], actions: [] } });
  jest.mocked(api.restoreSession).mockResolvedValue({ jwt: 'test-only', expiresAt: Date.now() + 600000 });
  jest.mocked(api.meetings).mockResolvedValue([{ id: 'meeting-1', title: 'Test toplantısı' }, { id: 'meeting-2', title: 'Boş toplantı' }]);
  jest.mocked(api.persistedResult).mockImplementation(async id => {
    if (id !== 'meeting-1') throw new Error('Sonuç bulunamadı');
    return { meetingId: id, analysisRunId: 'run-1', sessionId: 'session-1', generatedAt: '2026-09-21', summary: 'Kayıtlı özet',
      decisions: ['Kayıtlı karar'], actions: [{ text: 'Dosyayı hazırla', owner: 'Zeynep', dueDate: '2026-09-22' }], sources: [] };
  });
  const screen = render(<LiveTestScreen />);
  await waitFor(() => expect(screen.getByText('Test toplantısı')).toBeTruthy());
  fireEvent.press(screen.getByText('Test toplantısı'));
  for (const [tab, text] of [['Özet', 'Kayıtlı özet'], ['Kararlar', '• Kayıtlı karar'], ['Aksiyonlar', 'Dosyayı hazırla']]) {
    fireEvent.press(screen.getByRole('tab', { name: tab }));
    await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
    expect(screen.queryByText('OLD_LIVE')).toBeNull();
  }
  fireEvent.press(screen.getByText('Boş toplantı'));
  fireEvent.press(screen.getByRole('tab', { name: 'Aksiyonlar' }));
  await waitFor(() => expect(screen.getByText('Sonuç bulunamadı')).toBeTruthy());
  expect(screen.queryByText('Dosyayı hazırla')).toBeNull();
  fireEvent.press(screen.getByText('Test toplantısı'));
  fireEvent.press(screen.getByRole('tab', { name: 'Kararlar' }));
  await waitFor(() => expect(screen.getByText('• Kayıtlı karar')).toBeTruthy());
  expect(api.begin).not.toHaveBeenCalled();
});

it('renders successive live decisions and actions while the microphone is still running', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  const screen = await openAndStart();
  await act(async () => mockReady());
  const initial: AnalysisSnapshot = { version: 1, partial: true, summary: 'Canlı özet', decisions: ['Canlı karar'],
    actions: [{ text: 'İlk görev', owner: 'Zeynep', dueDate: null }] };
  await act(async () => mockAnalysis(initial));
  fireEvent.press(screen.getByRole('tab', { name: 'Kararlar' }));
  expect(screen.getByText('• Canlı karar')).toBeTruthy();
  fireEvent.press(screen.getByRole('tab', { name: 'Aksiyonlar' }));
  expect(screen.getByText('İlk görev')).toBeTruthy();
  await act(async () => mockAnalysis({ ...initial, version: 2, actions: [{ text: 'Güncellenmiş görev', owner: 'Mehmet', dueDate: '2026-09-23' }] }));
  expect(screen.getByText('Güncellenmiş görev')).toBeTruthy();
  expect(screen.queryByText('İlk görev')).toBeNull();
  expect(screen.getByText('● Mikrofon açık · Kayıt sürüyor')).toBeTruthy();
  expect(screen.getByTestId('recording-controls')).toBeTruthy();
  expect(mockStop).not.toHaveBeenCalled(); expect(api.completeCapture).not.toHaveBeenCalled();
  expect(screen.queryByText('Kaydedilmiş toplantı sonucu')).toBeNull();
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  fireEvent.press(screen.getByRole('tab', { name: 'Tanılama' }));
  fireEvent.press(screen.getByText('Tanılama kaydını paylaş'));
  const message = (share.mock.calls[0][0] as { message: string }).message;
  expect(message).toContain('adet=1; sürüm=1; taslak=true; özet karakteri=10; karar=1; aksiyon=1; mikrofon açık=true');
  expect(message).toContain('adet=2; sürüm=2; taslak=true; özet karakteri=10; karar=1; aksiyon=1; mikrofon açık=true');
  expect(message).not.toMatch(/Zeynep|Mehmet|Canlı özet|İlk görev|Güncellenmiş görev/);
  await act(async () => mockFailure('Kontrollü test kapanışı'));
});

it('keeps the synchronous closing analysis counters but rejects late diagnostics after the run ends', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  mockDrain.mockResolvedValue(true);
  const screen = await openAndStart();
  await act(async () => mockReady());
  await act(async () => mockAnalysis({ version: 1, partial: true, summary: '', decisions: [], actions: [] }));
  const previousDiagnostic = mockAnalysisDiagnostic;
  fireEvent.press(screen.getByText('Durdur'));
  const stopPrompt = jest.mocked(Alert.alert).mock.calls.find(call => call[0] === 'Kaydı bitir?');
  await act(async () => stopPrompt?.[2]?.[1].onPress?.());
  await waitFor(() => expect(api.completeCapture).toHaveBeenCalled());
  fireEvent.press(screen.getByRole('tab', { name: 'Tanılama' }));
  expect(screen.getByText(/Canlı analiz akışı: bağlantı=1, bayt=413/)).toBeTruthy();
  await act(async () => previousDiagnostic?.('LATE_OLD_CONNECTION'));
  expect(screen.queryByText(/LATE_OLD_CONNECTION/)).toBeNull();
});


it('exports persistent meeting diagnostics after remount without saving spoken text', async () => {
  const id = '604593c5-9c2d-4c86-bc1d-2aec2270cf99';
  const entries: Entry[] = [];
  jest.mocked(api.lifecycleOwner).mockResolvedValue('a'.repeat(64));
  jest.mocked(api.meetings).mockResolvedValue([{ id, title: 'Test toplantısı' }]);
  jest.mocked(openAccountHistory).mockImplementation(async () => new DiagnosticHistory({
    append: entry => { entries.push(entry); }, read: meeting => ({ entries: entries.filter(e => e.meeting === meeting), removed: 0 }),
    clear: jest.fn(), close: jest.fn(),
  }));
  mockPermission.mockResolvedValue({ granted: true });
  jest.mocked(api.begin).mockImplementationOnce(async (_jwt, _meeting, onStage) => {
    for (const stage of ['Önceki kaydın kapanış bağlantısı doğrulanıyor', 'Kayıt onayının sunucuya kaydı',
      'Canlı ses oturumu oluşturma', 'Toplantı kayıt bağlantısı doğrulanıyor', 'Ses sağlayıcısı doğrulandı: Speechmatics (canlı)']) onStage?.(stage);
    return 'SES-diagnostic-test';
  });
  const first = await openAndStart();
  await act(async () => { mockReady(); });
  await act(async () => { mockText({ seq: 3, text: 'PRIVATE_NAME. PRIVATE_TASK', final: true }); });
  await act(async () => { mockAnalysis({ version: 7, partial: true, summary: 'PRIVATE_SUMMARY', decisions: [], actions: [{ text: 'PRIVATE_ACTION', owner: null, dueDate: null }] }); });
  await act(async () => { mockFailure('Controlled transport failure'); });
  await act(async () => { first.unmount(); });
  expect(entries.some(e => e.kind === 'run_started')).toBe(true);
  expect(entries.some(e => e.kind === 'analysis' && e.data.missingOwners === 1)).toBe(true);
  expect(entries.filter(e => e.kind === 'stage').map(e => e.data.stage)).toEqual(expect.arrayContaining([6, 7, 8, 9, 10]));
  expect(entries.filter(e => e.kind === 'stage').some(e => e.data.stage === -1)).toBe(false);
  jest.mocked(api.restoreSession).mockResolvedValue({ jwt: 'test-only', expiresAt: Date.now() + 600000 });
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  const second = render(<LiveTestScreen />);
  await waitFor(() => expect(second.getByText('Test toplantısı')).toBeTruthy());
  fireEvent.press(second.getByText('Test toplantısı'));
  fireEvent.press(second.getByText('Tanılama'));
  await act(async () => { fireEvent.press(second.getByText('Tanılama kaydını paylaş')); });
  const report = String(share.mock.calls.at(-1)?.[0].message);
  expect(report).toContain('Kayıt denemesi başladı');
  expect(report).toContain('Kesin metin olayı');
  expect(report).toContain('"missingOwners":1');
  expect(report).not.toContain('PRIVATE');
  await act(async () => { second.unmount(); });
});

it('closes a diagnostic store that finishes opening after the screen was left', async () => {
  let finish!: (history: DiagnosticHistory) => void;
  jest.mocked(api.lifecycleOwner).mockResolvedValue('a'.repeat(64));
  jest.mocked(openAccountHistory).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const first = render(<LiveTestScreen />);
  await act(async () => {});
  fireEvent.press(first.getByText('Giriş yap'));
  await waitFor(() => expect(openAccountHistory).toHaveBeenCalled());
  first.unmount();
  const close = jest.fn();
  await act(async () => { finish(new DiagnosticHistory({ append: jest.fn(), read: () => ({ entries: [], removed: 0 }), clear: jest.fn(), close })); });
  expect(close).toHaveBeenCalledTimes(1);
});

it.each([true, false])('explains unavailable history and exports only a safe opening code (known=%s)', async known => {
  jest.mocked(openAccountHistory).mockRejectedValue(known ? new DiagnosticOpenError('HISTORY_DIRECTORY') : new Error('PRIVATE_PATH_KEY_TOKEN'));
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  const screen = render(<LiveTestScreen />);
  await act(async () => {});
  await act(async () => fireEvent.press(screen.getByText('Giriş yap')));
  fireEvent.press(screen.getByText('Test toplantısı'));
  fireEvent.press(screen.getByText('Tanılama'));
  const code = known ? 'HISTORY_DIRECTORY' : 'HISTORY_UNKNOWN';
  expect(screen.getByText(new RegExp(`İnceleme kodu: ${code}`))).toBeTruthy();
  expect(screen.getByText(/Kalıcı tanılama hazır değil/)).toBeTruthy();
  expect(screen.queryByText('Ayrıntılı test raporunu paylaş')).toBeNull();
  await act(async () => fireEvent.press(screen.getByText('Tanılama kaydını paylaş')));
  expect(share.mock.calls[0][0].message).toContain(code);
  expect(share.mock.calls[0][0].message).not.toContain('PRIVATE');
  screen.unmount();
});

it('isolates diagnostic exports across logout/login and ignores the old account callbacks', async () => {
  const id = '604593c5-9c2d-4c86-bc1d-2aec2270cf99';
  const accounts: Record<string, Entry[]> = { 'test-only': [], 'account-b': [] };
  jest.mocked(api.meetings).mockResolvedValue([{ id, title: 'Test toplantısı' }]);
  jest.mocked(openAccountHistory).mockImplementation(async jwt => new DiagnosticHistory({
    append: entry => { accounts[jwt].push(entry); }, read: meeting => ({ entries: accounts[jwt].filter(e => e.meeting === meeting), removed: 0 }),
    clear: jest.fn(), close: jest.fn(),
  }));
  mockPermission.mockResolvedValue({ granted: true });
  const screen = await openAndStart();
  await act(async () => mockReady());
  await act(async () => mockText({ seq: 1, text: 'PRIVATE', final: true }));
  const oldText = mockText; const oldFailure = mockFailure;
  await act(async () => mockFailure('Controlled stop'));
  fireEvent.press(screen.getByText('Toplantı seç / ayarlar'));
  await act(async () => fireEvent.press(screen.getByText('Çıkış yap')));
  const countA = accounts['test-only'].length;
  jest.mocked(api.login).mockResolvedValue({ jwt: 'account-b', expiresAt: Date.now() + 600000 });
  await act(async () => fireEvent.press(screen.getByText('Giriş yap')));
  await waitFor(() => expect(screen.getByText('Test toplantısı')).toBeTruthy());
  fireEvent.press(screen.getByText('Test toplantısı'));
  await act(async () => { oldText({ seq: 999, text: 'OLD_PRIVATE', final: true }); oldFailure('OLD_FAILURE'); });
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  fireEvent.press(screen.getByText('Tanılama'));
  await act(async () => fireEvent.press(screen.getByText('Tanılama kaydını paylaş')));
  expect(accounts['test-only']).toHaveLength(countA);
  expect(accounts['account-b'].some(e => e.kind === 'transcript')).toBe(false);
  expect(String(share.mock.calls.at(-1)?.[0].message)).not.toMatch(/Kesin metin olayı|Kayıt denemesi başladı|PRIVATE/);
  expect(screen.queryByText('OLD_FAILURE')).toBeNull();
  await act(async () => screen.unmount());
});

it.each(['android', 'ios'] as const)('starts audio despite optional diagnostic failures on %s', async platform => {
  jest.replaceProperty(Platform, 'OS', platform);
  const id = '604593c5-9c2d-4c86-bc1d-2aec2270cf99';
  jest.spyOn(Crypto, 'randomUUID').mockReturnValue(id);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const journal = new DiagnosticHistory({ append: jest.fn(), read: () => ({ entries: [], removed: 0 }),
    clear: jest.fn(), close: jest.fn(), appendDetail: jest.fn() });
  // Exercise the screen boundary too: selection, capture, callbacks and cleanup must all survive.
  jest.spyOn(journal, 'record').mockImplementation(() => { throw new Error('PRIVATE_JOURNAL_FAILURE'); });
  const begin = jest.spyOn(journal, 'beginDetailed').mockImplementation(() => { throw new Error('PRIVATE_SETUP_FAILURE'); });
  jest.mocked(openAccountHistory).mockResolvedValue(journal);
  jest.mocked(api.meetings).mockResolvedValue([{ id, title: 'Test toplantısı' }]);
  mockPermission.mockResolvedValue({ granted: true });
  const screen = render(<LiveTestScreen />);
  await act(async () => {});
  await act(async () => fireEvent.press(screen.getByText('Giriş yap')));
  fireEvent.press(screen.getByText('Test toplantısı'));
  fireEvent.press(screen.getByText('Konuşma testini başlat'));
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());
  await waitFor(() => expect(api.begin).toHaveBeenCalledTimes(1));
  expect(screen.queryByLabelText('Sonraki testte ayrıntılı tanılama')).toBeNull();
  await act(async () => mockReady());
  expect(screen.getByText('● Mikrofon açık · Kayıt sürüyor')).toBeTruthy();
  await act(async () => mockFailure('Kontrollü test kapanışı'));
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  fireEvent.press(screen.getByText('Tanılama'));
  fireEvent.press(screen.getByText('Tanılama kaydını paylaş'));
  expect(screen.queryByText('Ayrıntılı test raporunu paylaş')).toBeNull();
  expect(share.mock.calls[0][0].message).not.toContain('PRIVATE');
  fireEvent.press(screen.getByText('Konuşma testini başlat'));
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());
  await waitFor(() => expect(api.begin).toHaveBeenCalledTimes(2));
  expect(begin).not.toHaveBeenCalled(); // Detailed capture was withdrawn; no new content writes.
  await act(async () => mockFailure('Kontrollü test kapanışı'));
  await act(async () => screen.unmount());
});

it('releases the startup lock after a preparation failure and allows a second confirmed attempt', async () => {
  jest.spyOn(Crypto, 'randomUUID').mockImplementationOnce(() => { throw new Error('PRIVATE_NATIVE_FAILURE'); });
  mockPermission.mockResolvedValue({ granted: true });
  const screen = await openAndStart();
  await waitFor(() => expect(screen.getByText(/İnceleme kodu: START_ID/)).toBeTruthy());
  expect(api.begin).not.toHaveBeenCalled();
  expect(mockPermission).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Konuşma testini başlat'));
  await act(async () => jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.[1].onPress?.());
  await waitFor(() => expect(api.begin).toHaveBeenCalledTimes(1));
  await act(async () => mockReady());
  expect(screen.getByText('● Mikrofon açık · Kayıt sürüyor')).toBeTruthy();
  await act(async () => mockFailure('Kontrollü test kapanışı'));
  await act(async () => screen.unmount());
});

it('opens a separate meeting only after confirmation and starts it through the ordinary microphone consent', async () => {
  mockStream.isStreaming = false;
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(api.pendingRecording).mockResolvedValue({ meetingId: 'meeting-1', sessionId: 'SES-old', incomplete: true, abandoning: false });
  jest.mocked(api.createMeeting).mockResolvedValue({ id: 'meeting-2', title: 'Yeni toplantı' });
  mockPermission.mockResolvedValue({ granted: true });
  const screen = render(<LiveTestScreen />);
  await act(async () => {});
  await act(async () => fireEvent.press(screen.getByText('Giriş yap')));
  fireEvent.press(screen.getByText('Test toplantısı'));
  await waitFor(() => expect(screen.getByText('Önceki kaydı koru, yeni toplantı aç')).toBeTruthy());
  fireEvent.press(screen.getByText('Önceki kaydı koru, yeni toplantı aç'));
  expect(api.createMeeting).not.toHaveBeenCalled();
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(api.begin).not.toHaveBeenCalled();
  expect(api.abandonRecording).not.toHaveBeenCalled();
  expect(screen.getByText(/Yeni toplantı hazır/)).toBeTruthy();
  fireEvent.press(screen.getByText('Konuşma testini başlat'));
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(api.begin).toHaveBeenCalledWith('test-only', 'meeting-2', expect.any(Function));
  mockStream.isStreaming = true;
  await act(async () => mockReady());
  expect(screen.getByText('● Mikrofon açık · Kayıt sürüyor')).toBeTruthy();
  await act(async () => mockFailure('Kontrollü test kapanışı'));
  await act(async () => screen.unmount());
});
