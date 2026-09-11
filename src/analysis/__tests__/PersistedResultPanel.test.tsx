import { act, fireEvent, render } from '@testing-library/react-native';
import { PersistedResultPanel } from '../PersistedResultPanel';
import type { PersistedResult } from '../persistedResult';
jest.mock('../../audio/liveTestApi', () => ({ persistedResult: jest.fn() }));
const result = (meetingId: string): PersistedResult => ({ meetingId, analysisRunId: 'run', sessionId: 'SES-1', generatedAt: '2026-09-10',
  summary: 'Kalıcı özet', decisions: [], actions: [], sources: [{ claim: 'Karar', text: 'Kaynak alıntısı', startSec: 12 }] });
test('reads on request and opens source excerpts', async () => {
  const load = jest.fn().mockResolvedValue(result('A'));
  const screen = render(<PersistedResultPanel meetingId="A" load={load} />);
  expect(load).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByText('Kalıcı sonucu aç / yenile')));
  expect(screen.getByText('Kalıcı özet')).toBeTruthy();
  fireEvent.press(screen.getByText('Kaynakları göster'));
  expect(screen.getByText('Kaynak alıntısı')).toBeTruthy();
});
test('late response cannot restore the previous meeting and duplicate taps are suppressed', async () => {
  let resolve!: (r: PersistedResult) => void;
  const load = jest.fn(() => new Promise<PersistedResult>(r => { resolve = r; }));
  const screen = render(<PersistedResultPanel meetingId="A" load={load} />);
  fireEvent.press(screen.getByText('Kalıcı sonucu aç / yenile'));
  fireEvent.press(screen.getByText('Sonuç okunuyor…'));
  expect(load).toHaveBeenCalledTimes(1);
  screen.rerender(<PersistedResultPanel meetingId="B" load={load} />);
  await act(async () => resolve(result('A')));
  expect(screen.queryByText('Kalıcı özet')).toBeNull();
  expect(screen.getByText('Kalıcı sonucu aç / yenile')).toBeTruthy();
});
