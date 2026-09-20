import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, AppState, Text as MockText } from 'react-native';
import LiveTestScreen from '../../../app/live-test';
import * as api from '../liveTestApi';

let mockText: (line: object) => void;
let mockSnapshot: (snapshot: object) => void;
const mockStream = { start: jest.fn(async () => {}), stop: jest.fn(), sampleRate: 16000, channels: 1, isStreaming: true };
jest.mock('expo-audio', () => ({ AudioModule: { requestRecordingPermissionsAsync: async () => ({ granted: true }) }, useAudioStream: () => ({ stream: mockStream }) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));
jest.mock('../backgroundCapture', () => ({ supportsBackgroundCapture: () => false, configureBackgroundCapture: async () => {} }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('../liveTestApi', () => ({ login: jest.fn(), meetings: jest.fn(), begin: jest.fn(), finish: jest.fn(), restoreSession: jest.fn(), validSession: jest.fn(), logout: jest.fn(), BASE_URL: 'https://example.test', CONSENT: 'Synthetic consent' }));
jest.mock('../../transcript/TranscriptView', () => ({ TranscriptView: ({ lines }: { lines: { text: string }[] }) => <MockText>{lines.map(l => l.text).join(' ')}</MockText> }));
jest.mock('../../analysis/LiveAnalysisPanel', () => ({ LiveAnalysisPanel: ({ snapshot }: { snapshot: { summary: string } | null }) => <MockText>{snapshot?.summary}</MockText> }));
jest.mock('../../analysis/analysisSubscription', () => ({ subscribeAnalysis: (options: { onSnapshot: typeof mockSnapshot }) => { mockSnapshot = options.onSnapshot; return jest.fn(); } }));
jest.mock('../foregroundStream', () => ({ ForegroundStream: jest.fn().mockImplementation((_socket, ready, text) => { mockText = text; ready(); return { stop: async () => true, dispose: jest.fn(), diagnostics: () => ({}) }; }) }));

beforeEach(() => {
  jest.clearAllMocks();
  const token = { jwt: 'synthetic-test-only', expiresAt: Date.now() + 600000 };
  jest.mocked(api.restoreSession).mockResolvedValue(token);
  jest.mocked(api.validSession).mockResolvedValue(token);
  jest.mocked(api.meetings).mockResolvedValue([{ id: 'meeting-A', title: 'Meeting A' }, { id: 'meeting-B', title: 'Meeting B' }]);
  jest.mocked(api.begin).mockResolvedValue('synthetic-session-A');
  jest.mocked(api.finish).mockResolvedValue(undefined);
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
});
afterEach(() => jest.restoreAllMocks());

test.each([
  ['select', 'transcript'], ['select', 'summary'],
  ['refresh', 'transcript'], ['refresh', 'summary'],
])('%s removes previous meeting %s', async (change, field) => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<LiveTestScreen />);
  await waitFor(() => expect(screen.getByText('Meeting A')).toBeTruthy());
  fireEvent.press(screen.getByText('Meeting A'));
  fireEvent.press(screen.getByText('Konuşma testini başlat'));
  await act(async () => { alert.mock.calls[0][2]?.[1].onPress?.(); });
  await act(async () => {
    mockText({ seq: 1, text: 'SYNTHETIC_A_TRANSCRIPT', final: true });
    mockSnapshot({ version: 1, partial: true, summary: 'SYNTHETIC_A_SUMMARY', decisions: [], actions: [] });
  });
  expect(screen.getByText('SYNTHETIC_A_TRANSCRIPT')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByText('Durdur')));
  await act(async () => { alert.mock.calls.at(-1)?.[2]?.[1].onPress?.(); });
  fireEvent.press(screen.getByText('Toplantı seç / ayarlar'));
  if (change === 'select') {
    fireEvent.press(screen.getByText('Meeting B'));
    expect(screen.getByText('✓ Meeting B')).toBeTruthy();
  } else {
    jest.mocked(api.meetings).mockResolvedValue([{ id: 'meeting-B', title: 'Meeting B' }]);
    await act(async () => fireEvent.press(screen.getByText('Listeyi yenile')));
    expect(screen.queryByText('✓ Meeting A')).toBeNull();
  }
  await act(async () => { mockText({ seq: 2, text: 'LATE_A_TRANSCRIPT', final: true }); });
  expect(screen.queryByText('LATE_A_TRANSCRIPT')).toBeNull();
  if (field === 'transcript') expect(screen.queryByText('SYNTHETIC_A_TRANSCRIPT')).toBeNull();
  else {
    fireEvent.press(screen.getByText('Özet'));
    expect(screen.queryByText('SYNTHETIC_A_SUMMARY')).toBeNull();
  }
});
