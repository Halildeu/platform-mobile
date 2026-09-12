import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { printAsync } from 'expo-print';
import { LiveAnalysisPanel } from '../LiveAnalysisPanel';

jest.mock('expo-print', () => ({ printAsync: jest.fn() }));
const snapshot = { version: 1, partial: true, summary: 'Doğrulanmış özet', decisions: [], actions: [] };

beforeEach(() => jest.clearAllMocks());
it('opens native PDF/print only after the user requests export', async () => {
  jest.mocked(printAsync).mockResolvedValue(undefined);
  const screen = render(<LiveAnalysisPanel snapshot={snapshot} status="Canlı" />);
  expect(printAsync).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Canlı taslağı PDF / Yazdır'));
  await waitFor(() => expect(printAsync).toHaveBeenCalledWith({ html: expect.stringContaining('Doğrulanmış özet') }));
});
it('shows a safe cancellation/failure message without native error content', async () => {
  jest.mocked(printAsync).mockRejectedValue(new Error('private-native-payload'));
  const screen = render(<LiveAnalysisPanel snapshot={snapshot} status="Canlı" />);
  fireEvent.press(screen.getByText('Canlı taslağı PDF / Yazdır'));
  await waitFor(() => expect(screen.getByText(/PDF\/yazdırma tamamlanmadı/)).toBeTruthy());
  expect(screen.queryByText(/private-native-payload/)).toBeNull();
});
it('does not offer export without a validated snapshot', () => {
  const screen = render(<LiveAnalysisPanel snapshot={null} status="Bekleniyor" />);
  expect(screen.queryByText('PDF / Yazdır')).toBeNull();
});
