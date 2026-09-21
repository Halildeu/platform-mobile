import { act, fireEvent, render } from '@testing-library/react-native';
import { PersistedResultPanel } from '../PersistedResultPanel';
import type { PersistedResult } from '../persistedResult';
import { Share } from 'react-native';
import { printAsync } from 'expo-print';
import { resultExporter } from '../nativeResultExport';
jest.mock('../../auth/mobileSession', () => ({ mobileSession: { contentScope: () => 1 } }));
jest.mock('../nativeResultExport', () => ({ resultExporter: { copy: jest.fn().mockResolvedValue(undefined), pdf: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('expo-print', () => ({ printAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../audio/liveTestApi', () => ({ persistedResult: jest.fn() }));
const result = (meetingId: string): PersistedResult => ({ meetingId, analysisRunId: 'run', sessionId: 'SES-1', generatedAt: '2026-09-10',
  summary: 'Kalıcı özet', decisions: [], actions: [], sources: [{ claim: 'Karar', text: 'Kaynak alıntısı', startSec: 12 }] });

test('exports the loaded saved result without inventing a live version', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  const screen = render(<PersistedResultPanel meetingId="A" load={async () => result('A')} />);
  await act(async () => {});
  await act(async () => fireEvent.press(screen.getByText('Kaydedilmiş sonucu Markdown olarak paylaş')));
  const message = (share.mock.calls[0][0] as { message: string }).message;
  expect(message).toContain('Kaydedilmiş toplantı sonucu');
  expect(message).toContain('Kalıcı özet');
  expect(message).not.toContain('Sürüm:');
  await act(async () => fireEvent.press(screen.getByText('Kaydedilmiş sonucu PDF olarak paylaş')));
  expect(resultExporter.pdf).toHaveBeenCalledWith(expect.stringContaining('Kaydedilmiş toplantı sonucu'), expect.any(Function));
  await act(async () => fireEvent.press(screen.getByText('Kaydedilmiş sonucun tamamını kopyala')));
  expect(resultExporter.copy).toHaveBeenCalledWith(message, expect.any(Function));
  await act(async () => fireEvent.press(screen.getByText('Kaydedilmiş sonucu yazdır')));
  expect(printAsync).toHaveBeenCalledWith({ html: expect.stringContaining('Kaydedilmiş toplantı sonucu') });
  share.mockRestore();
});
test('shows automatic restore failures and records diagnostics rather than a blank panel', async () => {
  const onDiagnostic = jest.fn();
  const screen = render(<PersistedResultPanel meetingId="A" load={async () => { throw new Error('Kalıcı sonuç 404'); }} onDiagnostic={onDiagnostic} />);
  await act(async () => {});
  expect(screen.getByText('Kalıcı sonuç 404')).toBeTruthy();
  expect(onDiagnostic).toHaveBeenLastCalledWith('Kalıcı sonuç 404');
});
test('keeps the current result while refreshing but clears it if access fails', async () => {
  let rejectRefresh!: (error: Error) => void;
  const load = jest.fn().mockResolvedValueOnce(result('A')).mockImplementationOnce(() =>
    new Promise<PersistedResult>((_, reject) => { rejectRefresh = reject; }));
  const screen = render(<PersistedResultPanel meetingId="A" load={load} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Kalıcı sonucu aç / yenile'));
  expect(screen.getByText('Kalıcı özet')).toBeTruthy();
  expect(screen.getByText('Sonuç okunuyor…')).toBeTruthy();
  await act(async () => rejectRefresh(new Error('Erişim reddedildi')));
  expect(screen.queryByText('Kalıcı özet')).toBeNull();
  expect(screen.getByText('Erişim reddedildi')).toBeTruthy();
});
test('explains missing analysis sections without inventing content', async () => {
  const screen = render(<PersistedResultPanel meetingId="A" load={async () => ({ ...result('A'), summary: '' })} />);
  await act(async () => {});
  expect(screen.getByText('Bu sonuçta gösterilebilir özet bulunmuyor.')).toBeTruthy();
  expect(screen.getByText('Bu sonuçta karar bulunmuyor.')).toBeTruthy();
  expect(screen.getByText('Bu sonuçta aksiyon bulunmuyor.')).toBeTruthy();
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

test('section changes keep the validated occurrence and clearly export the complete saved report', async () => {
  const value = { ...result('A'), decisions: ['Çevrim içi sunum'], actions: [{ text: 'Dosyayı hazırla', owner: 'Zeynep', dueDate: '2026-09-22' }] };
  const load = jest.fn().mockResolvedValue(value);
  const screen = render(<PersistedResultPanel meetingId="A" section="summary" load={load} />);
  await act(async () => {});
  expect(screen.getByText('Kalıcı özet')).toBeTruthy();
  expect(screen.queryByText('Dosyayı hazırla')).toBeNull();
  screen.rerender(<PersistedResultPanel meetingId="A" section="decisions" load={load} />);
  expect(screen.getByText('• Çevrim içi sunum')).toBeTruthy();
  expect(screen.queryByText('Kalıcı özet')).toBeNull();
  screen.rerender(<PersistedResultPanel meetingId="A" section="actions" load={load} />);
  expect(screen.getByText('Dosyayı hazırla')).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.press(screen.getByText('Kaydedilmiş sonucun tamamını PDF olarak paylaş')));
  const html = jest.mocked(resultExporter.pdf).mock.calls.at(-1)?.[0];
  expect(html).toContain('Kalıcı özet'); expect(html).toContain('Çevrim içi sunum'); expect(html).toContain('Dosyayı hazırla');
});
