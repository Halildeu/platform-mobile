import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import LiveTestScreen from '../../../app/live-test';
import * as api from '../liveTestApi';
import { clearMeetingViews, saveMeetingView } from '../meetingViewCache';

const mockStart = jest.fn().mockResolvedValue(undefined);
const mockStop = jest.fn();
let mockStatusListener: (event: { isStreaming: boolean; captureId?: string; reason?: string }) => void;
const mockStream = {
  start: mockStart, stop: mockStop, sampleRate: 16000, channels: 1, isStreaming: true,
  workcubeCaptureId: '', workcubeLastStopReason: '', workcubePcmLifecycleVersion: 0, configureBackgroundCapture: jest.fn(),
  addListener: jest.fn((_name, listener) => { mockStatusListener = listener; return { remove: jest.fn() }; }),
};
const mockPermission = jest.fn();
const mockDrain = jest.fn();
let mockFailure: (message: string) => void;
let mockReady: () => void;
let mockParams: { notificationMeetingId?: string } = {};
jest.mock('expo-audio', () => ({
  AudioModule: { requestRecordingPermissionsAsync: (...args: unknown[]) => mockPermission(...args) },
  useAudioStream: () => ({ stream: mockStream }),
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('../backgroundCapture', () => ({ supportsBackgroundCapture: () => false, configureBackgroundCapture: jest.fn(async () => {}) }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('../../auth/mobileSession', () => ({ mobileSession: { contentScope: () => 1, snapshot: () => null } }));
jest.mock('../liveTestApi', () => ({
  login: jest.fn(), meetings: jest.fn(), begin: jest.fn(), finish: jest.fn(), createMeeting: jest.fn(),
  restoreSession: jest.fn(), validSession: jest.fn(), logout: jest.fn(), persistedResult: jest.fn(), savedTranscript: jest.fn(),
  BASE_URL: 'https://example.test', CONSENT: 'Test onayı',
}));
jest.mock('../../analysis/analysisSubscription', () => ({ subscribeAnalysis: () => jest.fn() }));
jest.mock('../../analysis/LiveAnalysisPanel', () => ({ LiveAnalysisPanel: () => null }));
jest.mock('../foregroundStream', () => ({ ForegroundStream: jest.fn().mockImplementation(
  (_socket, _ready, _text, failure) => {
    mockFailure = failure;
    mockReady = _ready;
    return { stop: mockDrain, dispose: jest.fn(), diagnostics: () => ({}) };
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  clearMeetingViews();
  mockParams = {};
  Object.assign(mockStream, { isStreaming: true, workcubeCaptureId: '', workcubeLastStopReason: '', workcubePcmLifecycleVersion: 0 });
  mockStart.mockResolvedValue(undefined);
  mockDrain.mockResolvedValue(false);
  jest.mocked(api.login).mockResolvedValue({ jwt: 'test-only', expiresAt: Date.now() + 600000 });
  jest.mocked(api.validSession).mockResolvedValue({ jwt: 'test-only', expiresAt: Date.now() + 600000 });
  jest.mocked(api.restoreSession).mockResolvedValue(null);
  jest.mocked(api.logout).mockResolvedValue(true);
  jest.mocked(api.meetings).mockResolvedValue([{ id: 'meeting-1', title: 'Test toplantısı' }]);
  jest.mocked(api.begin).mockResolvedValue('session-1');
  jest.mocked(api.finish).mockResolvedValue(undefined);
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});
afterEach(() => jest.restoreAllMocks());

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

it('does not show successful stop when finish validation fails after a drained stream', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  mockDrain.mockResolvedValue(true);
  jest.mocked(api.finish).mockRejectedValueOnce(new Error('Kayıt kapanışı doğrulanamadı.'));
  const screen = await openAndStart();
  await waitFor(() => expect(api.begin).toHaveBeenCalled());
  await act(async () => { mockReady(); });
  await act(async () => { fireEvent.press(screen.getByText('Durdur')); });
  const stopAlert = jest.mocked(Alert.alert).mock.calls.at(-1);
  expect(stopAlert?.[0]).toBe('Kaydı bitir?');
  expect(api.finish).not.toHaveBeenCalled();
  await act(async () => { stopAlert?.[2]?.[1].onPress?.(); });
  expect(api.finish).toHaveBeenCalledWith('test-only', 'session-1');
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
  expect(api.finish).not.toHaveBeenCalled();
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
    await act(async () => { jest.advanceTimersByTime(120000); });
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
  jest.mocked(api.savedTranscript).mockResolvedValue('FULL_SAVED_TRANSCRIPT');
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
  expect(api.finish).toHaveBeenCalledTimes(1);
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
  expect(api.finish).toHaveBeenCalledTimes(1);
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
  expect(api.finish).not.toHaveBeenCalled();
  expect(screen.getByText('● Mikrofon açık · Kayıt sürüyor')).toBeTruthy();
  await act(async () => {
    mockStream.isStreaming = false;
    mockStatusListener({ isStreaming: false, captureId: 'current-capture', reason: 'input-route-lost' });
  });
  expect(api.finish).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Kullanılan mikrofon veya kulaklık bağlantısı kesildi/)).toBeTruthy();
});

it('does not show microphone running if native start resolves after stopping without a status event', async () => {
  mockPermission.mockResolvedValue({ granted: true });
  mockStart.mockImplementationOnce(async () => { mockStream.isStreaming = false; });
  const screen = await openAndStart();
  await waitFor(() => expect(api.begin).toHaveBeenCalled());
  await act(async () => mockReady());
  expect(screen.queryByText('● Mikrofon açık · Kayıt sürüyor')).toBeNull();
  expect(api.finish).toHaveBeenCalledTimes(1);
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
  expect(api.finish).toHaveBeenCalledTimes(1);
  expect(screen.getByText('iOS ses servisi yeniden başlatıldı; mikrofon durduruldu.')).toBeTruthy();
  await act(async () => mockStatusListener({ isStreaming: false, captureId: 'current-capture', reason: 'media-services-reset' }));
  expect(api.finish).toHaveBeenCalledTimes(1);
});
