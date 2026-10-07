import { render, fireEvent, act } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';
import { HistoryPanel } from '../HistoryPanel';
import { DiagnosticHistory, type HistoryStore } from '../history';
import { reportFileExporter } from '../reportFile';
import { mobileSession } from '../../auth/mobileSession';
jest.mock('../reportFile', () => ({ reportFileExporter: { share: jest.fn() } }));
jest.mock('../../auth/mobileSession', () => ({ mobileSession: { contentScope: jest.fn(() => 1) } }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '0.2.0', extra: { sourceRevision: 'a'.repeat(40) } } } }));
const meeting = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
beforeEach(() => { jest.mocked(mobileSession.contentScope).mockReturnValue(1); });
test('token expiry during sharing cannot permanently lock buttons after refresh', async () => {
  let resolve!: () => void;
  jest.mocked(reportFileExporter.share).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const h = history(); const ui = render(<HistoryPanel history={h.value} meetingId={meeting} failure={false} />);
  fireEvent.press(ui.getByText('Tam tanılama geçmişini dosya olarak paylaş'));
  jest.mocked(mobileSession.contentScope).mockReturnValue(null);
  await act(async () => resolve());
  jest.mocked(mobileSession.contentScope).mockReturnValue(1);
  jest.mocked(reportFileExporter.share).mockResolvedValueOnce(undefined);
  const count = jest.mocked(reportFileExporter.share).mock.calls.length;
  await act(async () => fireEvent.press(ui.getByText('Tam tanılama geçmişini dosya olarak paylaş')));
  expect(reportFileExporter.share).toHaveBeenCalledTimes(count + 1);
});
function history() {
  const store: HistoryStore = { append: jest.fn(), read: () => ({ entries: [], removed: 0 }), clear: jest.fn(), close: jest.fn() };
  return { value: new DiagnosticHistory(store), store };
}
test('shares compact metadata and shows exact current source separately from historic events', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
  const h = history(); const ui = render(<HistoryPanel history={h.value} meetingId={meeting} failure={false} />);
  expect(ui.getByText(/Kaynak sürümü: a{40}/)).toBeTruthy();
  await act(async () => fireEvent.press(ui.getByText('Son hata ve olayların kısa raporunu paylaş')));
  expect(share).toHaveBeenCalledWith({ message: expect.stringContaining('Kısa mobil tanılama v1') });
  expect(share.mock.calls[0][0].message!.length).toBeLessThan(3500);
  share.mockRestore();
});
test('late file-share failure does not show an error in another meeting', async () => {
  let reject!: (e: Error) => void;
  jest.mocked(reportFileExporter.share).mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
  const h = history(); const ui = render(<HistoryPanel history={h.value} meetingId={meeting} failure={false} />);
  fireEvent.press(ui.getByText('Tam tanılama geçmişini dosya olarak paylaş'));
  const current = jest.mocked(reportFileExporter.share).mock.calls.at(-1)![1];
  expect(current()).toBe(true);
  ui.rerender(<HistoryPanel history={h.value} meetingId={other} failure={false} />);
  expect(current()).toBe(false);
  await act(async () => reject(new Error('late failure')));
  expect(ui.queryByText(/Paylaşım tamamlanamadı/)).toBeNull();
});
test('a stale clear confirmation cannot erase a previous meeting', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const h = history(); const ui = render(<HistoryPanel history={h.value} meetingId={meeting} failure={false} />);
  fireEvent.press(ui.getByText('Bu toplantının tanılama geçmişini temizle'));
  const confirm = alert.mock.calls.at(-1)![2]![1].onPress!;
  ui.rerender(<HistoryPanel history={h.value} meetingId={other} failure={false} />);
  act(() => confirm());
  expect(h.store.clear).not.toHaveBeenCalled(); alert.mockRestore();
});
