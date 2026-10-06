import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { PendingRecordingPanel } from '../PendingRecordingPanel';
import * as api from '../liveTestApi';
jest.mock('../liveTestApi', () => ({ validSession: jest.fn(), pendingRecording: jest.fn(), finish: jest.fn(), abandonRecording: jest.fn() }));
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(api.validSession).mockResolvedValue({ jwt: 'owner', expiresAt: Date.now() + 100000 });
  jest.mocked(api.pendingRecording).mockResolvedValue({ meetingId: 'meeting', sessionId: 'SES-owned', incomplete: true, abandoning: false });
});
afterEach(() => jest.restoreAllMocks());
test('an unrelated pending recording explains ordinary start without requiring another meeting', async () => {
  const separate = jest.fn(async () => {});
  const screen = render(<PendingRecordingPanel meetingId="new-meeting" onSeparateMeeting={separate} beforeResolve={async () => {}} />);
  await waitFor(() => expect(screen.getByText(/Seçili toplantıda Konuşma testini başlat/)).toBeTruthy());
  expect(screen.getByText('Önceki toplantının bekleyen kaydı')).toBeTruthy();
  expect(screen.queryByText('Önceki kaydı koru, yeni toplantı aç')).toBeNull();
  expect(api.finish).not.toHaveBeenCalled(); expect(api.abandonRecording).not.toHaveBeenCalled();
  expect(separate).not.toHaveBeenCalled();
});
test('explicit confirmation is required and local handle closes before abandon', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const release = jest.fn(async () => {});
  const screen = render(<PendingRecordingPanel beforeResolve={release} />);
  await waitFor(() => expect(screen.getByText('Eksik kaydı kapat ve yeni kayda geç')).toBeTruthy());
  fireEvent.press(screen.getByText('Eksik kaydı kapat ve yeni kayda geç'));
  expect(api.abandonRecording).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2]!;
  expect(buttons[0].style).toBe('cancel');
  await act(async () => { buttons[1].onPress?.(); });
  expect(api.abandonRecording).toHaveBeenCalledWith('owner', 'SES-owned');
  expect(release.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(api.abandonRecording).mock.invocationCallOrder[0]);
  expect(api.finish).not.toHaveBeenCalled();
  expect(screen.getByText('Kayıt eksik olarak kapatıldı. Yeni kayıt başlatabilirsiniz.')).toBeTruthy();
});
test('a persisted abandon resumes cleanup instead of relabeling the recording finished', async () => {
  jest.mocked(api.pendingRecording).mockResolvedValue({ meetingId: 'meeting', sessionId: 'SES-owned', incomplete: true, abandoning: true });
  const screen = render(<PendingRecordingPanel beforeResolve={async () => {}} />);
  await waitFor(() => expect(screen.getByText('Kapanışı tekrar kontrol et')).toBeTruthy());
  expect(screen.queryByText('Eksik kaydı kapat ve yeni kayda geç')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByText('Kapanışı tekrar kontrol et')); });
  expect(api.abandonRecording).toHaveBeenCalledWith('owner', 'SES-owned'); expect(api.finish).not.toHaveBeenCalled();
});
test('failed release retains the pending operation and does not send an abandon', async () => {
  jest.mocked(api.pendingRecording).mockResolvedValue({ meetingId: 'meeting', sessionId: 'SES-owned', incomplete: true, abandoning: true });
  const screen = render(<PendingRecordingPanel beforeResolve={async () => { throw new Error('Tampon kapanmadı'); }} />);
  await waitFor(() => expect(screen.getByText('Kapanışı tekrar kontrol et')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByText('Kapanışı tekrar kontrol et')); });
  expect(screen.getByText('Tampon kapanmadı')).toBeTruthy(); expect(api.abandonRecording).not.toHaveBeenCalled();
});

test('late pending read for a previously selected meeting cannot replace the current recovery target', async () => {
  type Pending = Awaited<ReturnType<typeof api.pendingRecording>>;
  let resolveA!: (value: Pending) => void;
  let resolveB!: (value: Pending) => void;
  jest.mocked(api.pendingRecording).mockImplementation((_jwt, meeting) => new Promise(resolve => {
    if (meeting === 'A') resolveA = resolve; else resolveB = resolve;
  }));
  const screen = render(<PendingRecordingPanel meetingId="A" beforeResolve={async () => {}} />);
  await waitFor(() => expect(api.pendingRecording).toHaveBeenCalledWith('owner', 'A'));
  screen.rerender(<PendingRecordingPanel meetingId="B" beforeResolve={async () => {}} />);
  await waitFor(() => expect(api.pendingRecording).toHaveBeenCalledWith('owner', 'B'));
  await act(async () => resolveB({ meetingId: 'B', sessionId: 'SES-B', incomplete: false, abandoning: false }));
  await act(async () => resolveA({ meetingId: 'A', sessionId: 'SES-A', incomplete: false, abandoning: false }));
  await act(async () => fireEvent.press(screen.getByText('Kapanışı tekrar kontrol et')));
  expect(api.finish).toHaveBeenCalledWith('owner', 'SES-B');
});

test('leaving during native release cancels the old separate-meeting confirmation', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  let released!: () => void;
  const separate = jest.fn(async () => {});
  const screen = render(<PendingRecordingPanel onSeparateMeeting={separate} beforeResolve={() => new Promise(resolve => { released = resolve; })} />);
  await waitFor(() => expect(screen.getByText('Önceki kaydı koru, yeni toplantı aç')).toBeTruthy());
  fireEvent.press(screen.getByText('Önceki kaydı koru, yeni toplantı aç'));
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());
  screen.unmount();
  await act(async () => released());
  expect(separate).not.toHaveBeenCalled();
});

test('storage capacity warning never suggests that another meeting bypasses the block', async () => {
  const screen = render(<PendingRecordingPanel meetingId="new-meeting" storageBlocked onSeparateMeeting={async () => {}} beforeResolve={async () => {}} />);
  await waitFor(() => expect(screen.getByText(/Yeni kayıt başlamadan ses depolama sorunu çözülmeli/)).toBeTruthy());
  expect(screen.queryByText(/Seçili toplantıda Konuşma testini başlat/)).toBeNull();
  expect(screen.queryByText('Önceki kaydı koru, yeni toplantı aç')).toBeNull();
  expect(api.finish).not.toHaveBeenCalled(); expect(api.abandonRecording).not.toHaveBeenCalled();
});
