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
