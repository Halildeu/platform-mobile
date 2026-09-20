import { FlatList } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SavedTranscript } from '../SavedTranscriptPanel';
import { parseSavedTranscript } from '../savedTranscript';
import { resultExporter } from '../nativeResultExport';
import { mobileSession } from '../../auth/mobileSession';
jest.mock('../../audio/liveTestApi', () => ({ savedTranscript: jest.fn(), persistedResult: jest.fn() }));
jest.mock('../../auth/mobileSession', () => ({ mobileSession: { contentScope: jest.fn(() => 1) } }));
jest.mock('../nativeResultExport', () => ({ resultExporter: { copy: jest.fn().mockResolvedValue(undefined), pdf: jest.fn().mockResolvedValue(undefined) } }));
beforeEach(() => { jest.clearAllMocks(); jest.mocked(mobileSession.contentScope).mockReturnValue(1); });

test('automatically restores selectable full text without an extra open button', async () => {
  const load = jest.fn().mockResolvedValue('Zeynep. Sunumu hazırlayacak.');
  const screen = render(<SavedTranscript meetingId="A" load={load} />);
  await waitFor(() => expect(screen.getByText('Zeynep. Sunumu hazırlayacak.').props.selectable).toBe(true));
  expect(load).toHaveBeenCalledWith('A');
  expect(screen.queryByText('Kaydedilen konuşma metnini aç')).toBeNull();
});

test('can retry an unavailable result', async () => {
  const load = jest.fn().mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce('Metin');
  const screen = render(<SavedTranscript meetingId="A" load={load} />);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  fireEvent.press(screen.getByText('Yeniden dene'));
  await waitFor(() => expect(screen.getByText('Metin')).toBeTruthy());
});

test('ignores a previous meeting response after switching meetings', async () => {
  let resolveA!: (text: string) => void;
  const load = jest.fn((id: string) => id === 'A' ? new Promise<string>(resolve => { resolveA = resolve; }) : Promise.resolve('B metni'));
  const screen = render(<SavedTranscript meetingId="A" load={load} />);
  screen.rerender(<SavedTranscript meetingId="B" load={load} />);
  await waitFor(() => expect(screen.getByText('B metni')).toBeTruthy());
  await act(async () => resolveA('A metni'));
  expect(screen.queryByText('A metni')).toBeNull();
});

test('rejects another meeting or analysis result', () => {
  const value = { meetingId: 'A', analysisRunId: 'run', transcript: 'Metin', transcriptSha256: 'a'.repeat(64) };
  expect(parseSavedTranscript(value, 'A', 'run')).toBe('Metin');
  expect(() => parseSavedTranscript(value, 'B', 'run')).toThrow();
  expect(() => parseSavedTranscript(value, 'A', 'other')).toThrow();
});

test('virtualizes long saved text without dropping or changing characters', async () => {
  const original = ('Zeynep görevini hazırlayacak. 📝\n').repeat(1000);
  const load = jest.fn().mockResolvedValue(original);
  const screen = render(<SavedTranscript meetingId="A" load={load} />);
  await waitFor(() => expect(screen.UNSAFE_getByType(FlatList)).toBeTruthy());
  const chunks = screen.UNSAFE_getByType(FlatList).props.data as string[];
  expect(chunks.length).toBeGreaterThan(4);
  expect(chunks.join('')).toBe(original);
  expect(chunks.every(chunk => Array.from(chunk).length <= 2000)).toBe(true);
  await act(async () => fireEvent.press(screen.getByText('Metnin tamamını kopyala')));
  expect(resultExporter.copy).toHaveBeenCalledWith(original, expect.any(Function));
  expect(screen.getByText('Metnin tamamı kopyalandı.')).toBeTruthy();
});

test('PDF includes the full immutable saved text and cancels its meeting scope on navigation', async () => {
  const screen = render(<SavedTranscript meetingId="A" load={async () => '<b>Zeynep</b> 📝\nSon cümle.'} />);
  await waitFor(() => expect(screen.getByText('Kaydedilmiş metni PDF olarak paylaş')).toBeTruthy());
  await act(async () => fireEvent.press(screen.getByText('Kaydedilmiş metni PDF olarak paylaş')));
  const [html, current] = jest.mocked(resultExporter.pdf).mock.calls[0];
  expect(html).toContain('&lt;b&gt;Zeynep&lt;/b&gt; 📝\nSon cümle.');
  expect(current()).toBe(true);
  screen.rerender(<SavedTranscript meetingId="B" load={async () => 'B'} />);
  expect(current()).toBe(false);
  await act(async () => {});
});

test('rejects a transcript response after the account changed', async () => {
  let resolve!: (text: string) => void;
  const screen = render(<SavedTranscript meetingId="A" load={() => new Promise(done => { resolve = done; })} />);
  jest.mocked(mobileSession.contentScope).mockReturnValue(2);
  await act(async () => resolve('Önceki hesabın metni'));
  expect(screen.queryByText('Önceki hesabın metni')).toBeNull();
  expect(screen.queryByText('Metnin tamamını kopyala')).toBeNull();
});
