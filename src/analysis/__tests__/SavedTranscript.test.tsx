import { act, fireEvent, render } from '@testing-library/react-native';
import { SavedTranscript } from '../SavedTranscriptPanel';
import { parseSavedTranscript } from '../savedTranscript';
jest.mock('../../audio/liveTestApi', () => ({ savedTranscript: jest.fn() }));
test('opens exact saved source only on request and allows text selection', async () => {
  const load = jest.fn().mockResolvedValue('Zeynep. Sunumu hazırlayacak.');
  const screen = render(<SavedTranscript meetingId="A" analysisRunId="run" load={load} />);
  expect(load).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByText('Kaydedilen konuşma metnini aç')));
  expect(load).toHaveBeenCalledWith('A', 'run');
  expect(screen.getByText('Zeynep. Sunumu hazırlayacak.').props.selectable).toBe(true);
});
test('clears previously displayed transcript when reread is denied', async () => {
  const load = jest.fn().mockResolvedValueOnce('Metin').mockRejectedValueOnce(new Error('403'));
  const screen = render(<SavedTranscript meetingId="A" analysisRunId="run" load={load} />);
  await act(async () => fireEvent.press(screen.getByText('Kaydedilen konuşma metnini aç')));
  await act(async () => fireEvent.press(screen.getByText('Kaydedilen konuşma metnini aç')));
  expect(screen.queryByText('Metin')).toBeNull();
  expect(screen.getByRole('alert')).toBeTruthy();
});
test('rejects another meeting or analysis result instead of showing its content', () => {
  const value = { meetingId: 'A', analysisRunId: 'run', transcript: 'Metin', transcriptSha256: 'a'.repeat(64) };
  expect(parseSavedTranscript(value, 'A', 'run')).toBe('Metin');
  expect(() => parseSavedTranscript(value, 'B', 'run')).toThrow();
  expect(() => parseSavedTranscript(value, 'A', 'other')).toThrow();
});
