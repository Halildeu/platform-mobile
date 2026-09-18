import { FlatList } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SavedTranscript } from '../SavedTranscriptPanel';
import { parseSavedTranscript } from '../savedTranscript';
jest.mock('../../audio/liveTestApi', () => ({ savedTranscript: jest.fn(), persistedResult: jest.fn() }));

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
});