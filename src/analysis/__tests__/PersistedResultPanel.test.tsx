import { act, fireEvent, render } from '@testing-library/react-native';
import { PersistedResultPanel } from '../PersistedResultPanel';
import type { PersistedResult } from '../persistedResult';
jest.mock('../../audio/liveTestApi', () => ({ persistedResult: jest.fn() }));
const result = (meetingId: string): PersistedResult => ({ meetingId, analysisRunId: 'run', sessionId: 'SES-1', generatedAt: '2026-09-10',
  summary: 'Kalıcı özet', decisions: [], actions: [], sources: [{ claim: 'Karar', text: 'Kaynak alıntısı', startSec: 12 }] });
test('shows automatic restore failures and records diagnostics rather than a blank panel', async () => {
  const onDiagnostic = jest.fn();
  const screen = render(<PersistedResultPanel meetingId="A" load={async () => { throw new Error('Kalıcı sonuç 404'); }} onDiagnostic={onDiagnostic} />);
  await act(async () => {});
  expect(screen.getByText('Kalıcı sonuç 404')).toBeTruthy();
  expect(onDiagnostic).toHaveBeenLastCalledWith('Kalıcı sonuç 404');
});
test('automatically restores the selected meeting and opens source excerpts', async () => {
  const load = jest.fn().mockResolvedValue(result('A'));
  const screen = render(<PersistedResultPanel meetingId="A" load={load} />);
  await act(async () => {});
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Kalıcı özet')).toBeTruthy();
  fireEvent.press(screen.getByText('Kaynakları göster'));
  expect(screen.getByText('Kaynak alıntısı')).toBeTruthy();
});
test('diagnostic callback rerenders do not repeat automatic restore', async () => {
  const load = jest.fn().mockResolvedValue(result('A'));
  const firstDiagnostic = jest.fn();
  const nextDiagnostic = jest.fn();
  const screen = render(<PersistedResultPanel meetingId="A" load={load} onDiagnostic={firstDiagnostic} />);
  await act(async () => {});
  screen.rerender(<PersistedResultPanel meetingId="A" load={load} onDiagnostic={nextDiagnostic} />);
  await act(async () => {});
  expect(load).toHaveBeenCalledTimes(1);
  expect(nextDiagnostic).not.toHaveBeenCalled();
  expect(screen.getByText('Kalıcı özet')).toBeTruthy();
});
test('manual refresh after a rerender uses the current loader and diagnostic callback', async () => {
  const firstLoad = jest.fn().mockResolvedValue(result('A'));
  const nextLoad = jest.fn().mockResolvedValue({ ...result('A'), summary: 'Güncel özet' });
  const nextDiagnostic = jest.fn();
  const screen = render(<PersistedResultPanel meetingId="A" load={firstLoad} />);
  await act(async () => {});
  screen.rerender(<PersistedResultPanel meetingId="A" load={nextLoad} onDiagnostic={nextDiagnostic} />);
  await act(async () => {});
  expect(nextLoad).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Kalıcı sonucu aç / yenile'));
  await act(async () => {});
  expect(nextLoad).toHaveBeenCalledTimes(1);
  expect(nextLoad).toHaveBeenCalledWith('A');
  expect(nextDiagnostic).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Güncel özet')).toBeTruthy();
});
test('late response cannot restore the previous meeting and duplicate taps are suppressed', async () => {
  let resolve!: (r: PersistedResult) => void;
  const load = jest.fn(() => new Promise<PersistedResult>(r => { resolve = r; }));
  const screen = render(<PersistedResultPanel meetingId="A" load={load} />);
  const resolveA = resolve;
  fireEvent.press(screen.getByText('Sonuç okunuyor…'));
  expect(load).toHaveBeenCalledTimes(1);
  screen.rerender(<PersistedResultPanel meetingId="B" load={load} />);
  await act(async () => resolveA(result('A')));
  expect(screen.queryByText('Kalıcı özet')).toBeNull();
  expect(screen.getByText('Sonuç okunuyor…')).toBeTruthy();
  await act(async () => resolve(result('B')));
  expect(load).toHaveBeenCalledTimes(2);
});
test('does not label an epoch source timestamp as recording-relative seconds', async () => {
  const value = result('A');
  value.sources[0].startSec = 1789046520.809;
  const screen = render(<PersistedResultPanel meetingId="A" load={async () => value} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Kaynakları göster'));
  expect(screen.queryByText('Kayıtta 1789046520.809. saniye')).toBeNull();
  expect(screen.getByText('Kaynak 1')).toBeTruthy();
  expect(screen.getByText('Kaynak alıntısı')).toBeTruthy();
});
