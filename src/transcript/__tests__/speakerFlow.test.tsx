import { render } from '@testing-library/react-native';
import { ForegroundStream, type LiveSocket } from '../../audio/foregroundStream';
import { applyTranscriptEvent, initialTranscriptState } from '../transcriptState';
import { TranscriptView, transcriptParagraphs } from '../TranscriptView';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, opts?: { number: number }) => opts ? `Speaker ${opts.number}` : key }) }));
const scope = '12345678-1234-3234-8234-123456789012';
const attribution = { scope, turns: [{ speaker: 'S1', textStart: 0, textEnd: 7, startMs: 0, endMs: 400 },
  { speaker: 'UU', textStart: 8, textEnd: 13, startMs: 300, endMs: 900 }] };

test('word-level speaker events render one labelled sentence and preserve corrections and scope boundaries', () => {
  const words = ['Mehmet', 'bütçe', 'tablosunu', 'kontrol', 'edecek', '.'];
  const events = words.map((text, seq) => ({ type: 'final' as const, seq, text,
    speakerAttribution: { scope, turns: [{ speaker: 'S1', textStart: 0, textEnd: text.length, startMs: 0, endMs: 100 }] },
  }));
  let state = events.reduce(applyTranscriptEvent, initialTranscriptState());
  const source = JSON.stringify(state);
  const screen = render(<TranscriptView lines={state.lines} />);
  expect(screen.getAllByText('Speaker 1: ')).toHaveLength(1);
  expect(screen.getByText('Speaker 1: Mehmet bütçe tablosunu kontrol edecek.')).toBeTruthy();
  expect(transcriptParagraphs(state.lines)[0].map(line => line.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(JSON.stringify(state)).toBe(source);
  state = applyTranscriptEvent(state, { ...events[2], text: 'raporunu', speakerAttribution: {
    scope, turns: [{ speaker: 'S1', textStart: 0, textEnd: 8, startMs: 0, endMs: 100 }],
  } });
  screen.rerender(<TranscriptView lines={state.lines} />);
  expect(screen.getByText('Speaker 1: Mehmet bütçe raporunu kontrol edecek.')).toBeTruthy();
  expect(state.lines[2].status).toBe('revised');
  state = applyTranscriptEvent(state, { ...events[2], speakerAttribution: {
    ...events[2].speakerAttribution, scope: '22345678-1234-3234-8234-123456789012',
  } });
  screen.rerender(<TranscriptView lines={state.lines} />);
  expect(transcriptParagraphs(state.lines).map(p => p.map(line => line.seq))).toEqual([[0, 1], [2], [3, 4, 5]]);
  expect(screen.getByText('Speaker 2: ')).toBeTruthy();
  state = applyTranscriptEvent(state, { ...events[2], speakerAttribution: undefined });
  screen.rerender(<TranscriptView lines={state.lines} />);
  expect(screen.queryByText('Speaker 2: ')).toBeNull();
  expect(transcriptParagraphs(state.lines).map(p => p.map(line => line.seq))).toEqual([[0, 1], [2], [3, 4, 5]]);
});

test('speaker changes and unknown labels never inherit another speaker', () => {
  const events = ['S1', 'S1', 'S2', 'UU', 'UU', 'S1'].map((speaker, seq) => ({
    type: 'final' as const, seq, text: 'söz', speakerAttribution: {
      scope, turns: [{ speaker, textStart: 0, textEnd: 3, startMs: 0, endMs: 100 }],
    },
  }));
  const state = events.reduce(applyTranscriptEvent, initialTranscriptState());
  const screen = render(<TranscriptView lines={state.lines} />);
  expect(transcriptParagraphs(state.lines).map(p => p.map(line => line.seq))).toEqual([[0, 1], [2], [3], [4], [5]]);
  expect(screen.getAllByText('Speaker 1: ')).toHaveLength(2);
  expect(screen.getAllByText('Speaker 2: ')).toHaveLength(1);
  expect(screen.getAllByText('transcript.unknownSpeaker: ')).toHaveLength(2);
});
test('real proxy final flows through socket, state and rendered anonymous labels; corrections clear stale labels', () => {
  jest.useFakeTimers();
  let state = initialTranscriptState();
  const socket: LiveSocket = { readyState: 1, bufferedAmount: 0, onopen: null, onclose: null, onerror: null, onmessage: null, send: jest.fn(), close: jest.fn() };
  const client = new ForegroundStream(socket, jest.fn(), line => {
    state = applyTranscriptEvent(state, { type: 'final', seq: line.seq, text: line.text, speakerAttribution: line.speakerAttribution });
  }, jest.fn());
  const final = { type: 'final', seq: 0, text: 'Merhaba dünya', reason: 'silence', elapsed_ms: 10, rms: 0.5,
    source_start_sample: 0, source_end_sample: 16000, speakerAttribution: attribution };
  const emit = (value: object) => socket.onmessage?.({ data: JSON.stringify(value) });
  emit({ type: 'ready' }); emit(final);
  expect(state.lines[0].speakerAttribution).toEqual(attribution);
  const screen = render(<TranscriptView lines={state.lines} />);
  expect(screen.getByText('Speaker 1: ')).toBeTruthy();
  expect(screen.getByText('transcript.unknownSpeaker: ')).toBeTruthy();
  expect(screen.getByText(/Merhaba/)).toBeTruthy(); expect(screen.getByText(/dünya/)).toBeTruthy();
  const before = state; emit(final); expect(state).toBe(before);
  // Same text can carry a corrected attribution; it is not a duplicate.
  emit({ ...final, speakerAttribution: { ...attribution, scope: '22345678-1234-3234-8234-123456789012' } });
  expect(state.lines[0].status).toBe('revised');
  screen.rerender(<TranscriptView lines={state.lines} />);
  expect(screen.getByText('Speaker 2: ')).toBeTruthy();
  emit({ ...final, speakerAttribution: undefined });
  expect(state.lines[0].speakerAttribution).toBeUndefined();
  screen.rerender(<TranscriptView lines={state.lines} />);
  expect(screen.queryByText(/Speaker 2/)).toBeNull();
  // Bad optional fields cannot lose speech or leak names into the screen/log.
  emit({ ...final, text: 'Düzeltilmiş metin', speakerAttribution: { ...attribution, scope: 'secret-name' } });
  expect(state.lines[0].text).toBe('Düzeltilmiş metin');
  expect(state.lines[0].speakerAttribution).toBeUndefined();
  expect(JSON.stringify(client.diagnostics())).not.toMatch(/Merhaba|secret-name|12345678/);
  screen.unmount(); client.dispose(); expect(jest.getTimerCount()).toBe(0); jest.useRealTimers();
});
