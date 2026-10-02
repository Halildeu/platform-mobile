import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';
import { DetailedReportPanel } from '../DetailedReportPanel';
import { DiagnosticHistory } from '../history';

const meeting = '00000000-0000-4000-8000-000000000001';
function journal() {
  return new DiagnosticHistory({ append: jest.fn(), read: () => ({ entries: [], removed: 0 }), clear: jest.fn(), close: jest.fn(),
    readDetails: () => ({ entries: [], removed: 0 }), clearDetails: jest.fn() });
}
afterEach(() => jest.restoreAllMocks());
test.each(['unmount-during-drain', 'different-account', 'different-meeting'] as const)('rejects pending content share and erase after %s', async mode => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  const history = journal();
  const read = jest.spyOn(history, 'detailedReport');
  const clear = jest.spyOn(history, 'clearDetails');
  const screen = render(<DetailedReportPanel history={history} meetingId={meeting} />);
  fireEvent.press(screen.getByText('Ayrıntılı test raporunu paylaş'));
  const pendingShare = alert.mock.calls.at(-1)?.[2]?.[1].onPress;
  fireEvent.press(screen.getByText('Ayrıntılı test kaydını temizle'));
  const pendingClear = alert.mock.calls.at(-1)?.[2]?.[1].onPress;
  if (mode === 'unmount-during-drain') screen.unmount(); // Journal is intentionally still open for async audio drain.
  else screen.rerender(<DetailedReportPanel history={mode === 'different-account' ? journal() : history}
    meetingId={mode === 'different-meeting' ? '00000000-0000-4000-8000-000000000002' : meeting} />);
  await act(async () => { pendingShare?.(); pendingClear?.(); });
  expect(share).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
});
