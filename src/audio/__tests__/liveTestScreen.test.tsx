import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import LiveTestScreen from '../../../app/live-test';
import * as api from '../liveTestApi';

const mockStart = jest.fn().mockResolvedValue(undefined);
const mockStop = jest.fn();
const mockPermission = jest.fn();
let mockFailure: (message: string) => void;
jest.mock('expo-audio', () => ({
  AudioModule: { requestRecordingPermissionsAsync: (...args: unknown[]) => mockPermission(...args) },
  useAudioStream: () => ({ stream: { start: mockStart, stop: mockStop, sampleRate: 16000, channels: 1 } }),
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('../backgroundCapture', () => ({ supportsBackgroundCapture: () => false, configureBackgroundCapture: jest.fn(async () => {}) }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('../liveTestApi', () => ({
  login: jest.fn(), meetings: jest.fn(), begin: jest.fn(), finish: jest.fn(), createMeeting: jest.fn(),
  restoreSession: jest.fn(), validSession: jest.fn(), logout: jest.fn(),
  BASE_URL: 'https://example.test', CONSENT: 'Test onayı',
}));
jest.mock('../../analysis/analysisSubscription', () => ({ subscribeAnalysis: () => jest.fn() }));
jest.mock('../../analysis/LiveAnalysisPanel', () => ({ LiveAnalysisPanel: () => null }));
jest.mock('../foregroundStream', () => ({ ForegroundStream: jest.fn().mockImplementation(
  (_socket, _ready, _text, failure) => {
    mockFailure = failure;
    return { stop: jest.fn().mockResolvedValue(false), dispose: jest.fn() };
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
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
