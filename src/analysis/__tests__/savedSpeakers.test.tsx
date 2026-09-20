import { FlatList } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { parseSavedTranscript, savedTranscriptRows, type SavedTranscriptRow } from '../savedTranscript';
import { SavedTranscript } from '../SavedTranscriptPanel';
import { resultExporter } from '../nativeResultExport';
jest.mock('../../audio/liveTestApi', () => ({ savedTranscript: jest.fn(), persistedResult: jest.fn() }));
jest.mock('../../auth/mobileSession', () => ({ mobileSession: { contentScope: jest.fn(() => 1) } }));
jest.mock('../nativeResultExport', () => ({ resultExporter: { copy: jest.fn().mockResolvedValue(undefined), pdf: jest.fn().mockResolvedValue(undefined) } }));
const scopeA = '11111111-1111-3111-8111-111111111111';
const scopeB = '22222222-2222-3222-8222-222222222222';
const segment = (text: string, scope = scopeA, speaker = 'S1') => ({ text, start: 1.001, end: 2.001,
  speakerAttribution: { scope, turns: [{ speaker, textStart: 0, textEnd: text.length, startMs: 0, endMs: 1000 }] } });
const payload = (segments = [segment('İş 📝')]) => ({ meetingId: 'A', analysisRunId: 'run', transcriptSha256: 'a'.repeat(64),
  transcript: segments.map(item => item.text).join('\n'), segmentCount: segments.length, segments });
const read = (value: unknown) => parseSavedTranscript(value, 'A', 'run');

test('retains exact text including emoji/newlines/whitespace while scopes remain separate', () => {
  const value = payload([segment('  İş 📝\n'), segment('Merhaba', scopeA, 'S2'), segment('Bitti', scopeB), segment(' ?', scopeA, 'UU'), segment('Son', scopeA)]);
  const result = read(value), rows = savedTranscriptRows(result);
  expect(rows.map(row => row.text).join('')).toBe(value.transcript);
  expect(rows.map(row => row.speaker)).toEqual([1, 2, 3, 'unknown', 1]);
  expect(savedTranscriptRows(read(payload([segment('Yeni', scopeB)])))[0].speaker).toBe(1);
});

test.each([
  { segments: undefined }, { segmentCount: 2 }, { segments: [] },
  { segments: [{ ...segment('Başka'), text: 'Başka' }] },
  { segments: [{ ...segment('İş 📝'), start: -1 }] },
  { segments: [{ ...segment('İş 📝'), end: Infinity }] },
])('unsafe optional segments fall back to unchanged canonical text: %#', delta => {
  const result = read({ ...payload(), ...delta });
  expect(result.segments).toBeUndefined();
  expect(savedTranscriptRows(result)).toEqual([{ text: 'İş 📝', speaker: undefined }]);
});

test.each([
  { scope: 'Zeynep', turns: [] },
  { scope: scopeA, turns: [{ speaker: 'Halil', textStart: 0, textEnd: 5, startMs: 0, endMs: 1000 }] },
  { scope: scopeA, turns: [{ speaker: 'S1', textStart: 0, textEnd: 4, startMs: 0, endMs: 1000 }] },
  { scope: scopeA, turns: [{ speaker: 'S1', textStart: 0, textEnd: 5, startMs: 0, endMs: 1001 }] },
])('ignores invalid attribution without deleting the usable text: %#', speakerAttribution => {
  const original = payload();
  const result = read({ ...original, segments: [{ ...original.segments[0], speakerAttribution }] });
  expect(result.text).toBe(original.transcript);
  expect(result.segments?.[0].speakerAttribution).toBeUndefined();
});

test('redacted, edited and missing-window segments do not acquire a speaker from adjacent text', () => {
  const known = segment('İş 📝');
  const result = read({ ...payload(), transcript: 'İş 📝\nDüzeltildi\nEksik', segmentCount: 4,
    segments: [known, { text: null, start: 2, end: 3, speakerAttribution: known.speakerAttribution },
      { text: 'Düzeltildi', start: 3, end: 4, speakerAttribution: known.speakerAttribution },
      { text: 'Eksik', start: 4, end: null, speakerAttribution: segment('Eksik').speakerAttribution }] });
  const rows = savedTranscriptRows(result);
  expect(rows.map(row => row.speaker)).toEqual([1, undefined, undefined]);
  expect(rows.map(row => row.text).join('')).toBe(result.text);
});

test('excessive optional turns stop parsing before traversing subsequent attribution', () => {
  const first = { ...segment('A'), speakerAttribution: { scope: scopeA, turns: new Array(30001) } };
  const second = { text: 'B', start: 2, end: 3,
    get speakerAttribution() { throw new Error('must not traverse the next attribution'); } };
  const result = read({ ...payload(), transcript: 'A\nB', segmentCount: 2, segments: [first, second] });
  expect(result.segments).toBeUndefined();
  expect(result.text).toBe('A\nB');
});

test('splits very long speaker text safely for virtualization without changing characters', () => {
  const result = read(payload([segment('📝 A '.repeat(1500))]));
  const rows = savedTranscriptRows(result);
  expect(rows.length).toBeGreaterThan(1);
  expect(rows.every(row => row.speaker === 1 && Array.from(row.text).length <= 2000)).toBe(true);
  expect(rows.map(row => row.text).join('')).toBe(result.text);
});

test('saved speaker labels survive a new mount; copy and PDF keep the immutable text', async () => {
  const original = payload([segment('<b>İş 📝</b>'), segment('Bitti', scopeB)]);
  const load = jest.fn().mockResolvedValue(read(original));
  const first = render(<SavedTranscript meetingId="A" load={load} />);
  await waitFor(() => expect(first.getByText('Konuşmacı 2')).toBeTruthy());
  first.unmount();
  const screen = render(<SavedTranscript meetingId="A" load={load} />);
  await waitFor(() => expect(screen.getByText('Konuşmacı 1')).toBeTruthy());
  expect(screen.getByText('<b>İş 📝</b>').props.selectable).toBe(true);
  const rows = screen.UNSAFE_getByType(FlatList).props.data as SavedTranscriptRow[];
  expect(rows.map(row => row.text).join('')).toBe(original.transcript);
  await act(async () => fireEvent.press(screen.getByText('Metnin tamamını kopyala')));
  expect(resultExporter.copy).toHaveBeenCalledWith(original.transcript, expect.any(Function));
  await act(async () => fireEvent.press(screen.getByText('Kaydedilmiş metni PDF olarak paylaş')));
  expect(jest.mocked(resultExporter.pdf).mock.calls[0][0]).toContain('&lt;b&gt;İş 📝&lt;/b&gt;\nBitti');
});
