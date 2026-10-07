import { fireEvent, render } from '@testing-library/react-native';
import { TranscriptView, transcriptParagraphs } from '../TranscriptView';
import { applyTranscriptEvents, initialTranscriptState, transcriptLineKey } from '../transcriptState';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const lines = [{ seq: 0, text: 'Merhaba', confirmed: 'Merhaba', tentative: '', status: 'stabilizing' as const }];

it('renders repeated wire sequences in order, with an isolated warning only on the interrupted draft', () => {
  const state = applyTranscriptEvents(initialTranscriptState(), [
    { type: 'final', connectionId: 1, seq: 0, text: 'Önceki kesin cümle.' },
    { type: 'partial', connectionId: 1, seq: 1, confirmed: 'Yarım', tentative: 'cümle' },
    { type: 'connection_interrupted', connectionId: 1 },
    { type: 'final', connectionId: 3, seq: 0, text: 'Sonraki kesin cümle.' },
  ]);
  const paragraphs = transcriptParagraphs(state.lines);
  expect(paragraphs.map(p => p.map(line => line.text))).toEqual([
    ['Önceki kesin cümle.'], ['Yarım cümle'], ['Sonraki kesin cümle.'],
  ]);
  expect(new Set(paragraphs.map(p => transcriptLineKey(p[0]))).size).toBe(3);
  const screen = render(<TranscriptView lines={state.lines} />);
  expect(screen.getByText('Önceki kesin cümle.')).toBeTruthy();
  expect(screen.getByText('Sonraki kesin cümle.')).toBeTruthy();
  expect(screen.getAllByText(/transcript.interruptedTag/)).toHaveLength(1);
  expect(screen.queryByText(/transcript.revisedTag|transcript.stabilizingTag/)).toBeNull();
});

it('groups word fragments without losing sequence IDs or revised content', () => {
  const fragments = ['Sunumu', 'Zeynep', 'hazırlayacak.', 'Yarın'].map((text, seq) => ({
    seq, text, confirmed: text, tentative: '', status: 'final' as const,
  }));
  expect(transcriptParagraphs(fragments).map(p => p.map(line => line.seq))).toEqual([[0, 1, 2, 3]]);
  const revised = fragments.map(line => line.seq === 1 ? { ...line, text: 'Ayşe', status: 'revised' as const } : line);
  expect(transcriptParagraphs(revised)[0][1].text).toBe('Ayşe');
  expect(fragments[1].text).toBe('Zeynep');
});

it('keeps unfinished drafts together and handles an empty transcript', () => {
  expect(transcriptParagraphs([])).toEqual([]);
  expect(transcriptParagraphs([...lines, { ...lines[0], seq: 1, text: 'dünya' }])).toHaveLength(1);
});

it('allows manual scroll and an explicit return to live text', () => {
  const screen = render(<TranscriptView lines={lines} />);
  expect(screen.getByText(/transcript.stabilizingTag/)).toBeTruthy();
  fireEvent.scroll(screen.getByTestId('transcript-list'), { nativeEvent: {
    contentOffset: { y: 0 }, contentSize: { height: 1000 }, layoutMeasurement: { height: 200 },
  } });
  expect(screen.getByText('transcript.followLatest')).toBeTruthy();
  screen.rerender(<TranscriptView lines={[...lines, { ...lines[0], seq: 1 }]} />);
  expect(screen.getByText('transcript.followLatest')).toBeTruthy();
  fireEvent.press(screen.getByText('transcript.followLatest'));
  expect(screen.queryByText('transcript.followLatest')).toBeNull();
});

it('does not offer automatic follow when explicitly disabled', () => {
  const screen = render(<TranscriptView lines={lines} autoScroll={false} />);
  fireEvent.scroll(screen.getByTestId('transcript-list'), { nativeEvent: {
    contentOffset: { y: 0 }, contentSize: { height: 1000 }, layoutMeasurement: { height: 200 },
  } });
  expect(screen.queryByText('transcript.followLatest')).toBeNull();
});
