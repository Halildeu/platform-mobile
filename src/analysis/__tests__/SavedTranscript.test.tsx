import { FlatList, TextInput } from 'react-native';
import { useState } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SavedTranscript } from '../SavedTranscriptPanel';
import { parseSavedTranscript, type SavedTranscriptDocument, type SavedTranscriptRow } from '../savedTranscript';
import { resultExporter } from '../nativeResultExport';
import { mobileSession } from '../../auth/mobileSession';
jest.mock('../../audio/liveTestApi', () => ({ savedTranscript: jest.fn(), persistedResult: jest.fn() }));
jest.mock('../../auth/mobileSession', () => ({ mobileSession: { contentScope: jest.fn(() => 1) } }));
jest.mock('../nativeResultExport', () => ({ resultExporter: { copy: jest.fn().mockResolvedValue(undefined), pdf: jest.fn().mockResolvedValue(undefined) } }));
beforeEach(() => { jest.clearAllMocks(); jest.mocked(mobileSession.contentScope).mockReturnValue(1); });
const doc = (text: string, meetingId = 'A'): SavedTranscriptDocument => ({ meetingId, analysisRunId: 'run', text,
  recordingOutcome: 'FINISHED', recordingIncompleteReason: null });

test('word-sized stored segments read and export as flowing text, with an exact original option', async () => {
  const original = 'Bugün\nsunum\nhazırlanacak\n.\nZeynep\nhazırlayacak.';
  const readable = 'Bugün sunum hazırlanacak. Zeynep hazırlayacak.';
  const document = doc(original);
  const screen = render(<SavedTranscript meetingId="A" load={async () => document} />);
  await waitFor(() => expect(screen.getByText(readable).props.selectable).toBe(true));
  await act(async () => fireEvent.press(screen.getByText('Metnin tamamını kopyala')));
  expect(resultExporter.copy).toHaveBeenLastCalledWith(readable, expect.any(Function));
  await act(async () => fireEvent.press(screen.getByText('Kaydedilmiş metni PDF olarak paylaş')));
  expect(jest.mocked(resultExporter.pdf).mock.calls.at(-1)?.[0]).toContain(readable);
  fireEvent.press(screen.getByText('Orijinal metni göster'));
  expect(screen.getByText(original).props.selectable).toBe(true);
  await act(async () => fireEvent.press(screen.getByText('Metnin tamamını kopyala')));
  expect(resultExporter.copy).toHaveBeenLastCalledWith(original, expect.any(Function));
  await act(async () => fireEvent.press(screen.getByText('Kaydedilmiş metni PDF olarak paylaş')));
  expect(jest.mocked(resultExporter.pdf).mock.calls.at(-1)?.[0]).toContain(original);
  expect(document.text).toBe(original);
});

test('automatically restores selectable full text without an extra open button', async () => {
  const load = jest.fn().mockResolvedValue(doc('Zeynep. Sunumu hazırlayacak.'));
  const screen = render(<SavedTranscript meetingId="A" load={load} />);
  await waitFor(() => expect(screen.getByText('Zeynep. Sunumu hazırlayacak.').props.selectable).toBe(true));
  expect(load).toHaveBeenCalledWith('A');
  expect(screen.queryByText('Kaydedilen konuşma metnini aç')).toBeNull();
});

test('can retry an unavailable result', async () => {
  const load = jest.fn().mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce(doc('Metin'));
  const screen = render(<SavedTranscript meetingId="A" load={load} />);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  fireEvent.press(screen.getByText('Yeniden dene'));
  await waitFor(() => expect(screen.getByText('Metin')).toBeTruthy());
});

test('ignores a previous meeting response after switching meetings', async () => {
  let resolveA!: (text: SavedTranscriptDocument) => void;
  const load = jest.fn((id: string) => id === 'A' ? new Promise<SavedTranscriptDocument>(resolve => { resolveA = resolve; }) : Promise.resolve(doc('B metni', 'B')));
  const screen = render(<SavedTranscript meetingId="A" load={load} />);
  screen.rerender(<SavedTranscript meetingId="B" load={load} />);
  await waitFor(() => expect(screen.getByText('B metni')).toBeTruthy());
  await act(async () => resolveA(doc('A metni')));
  expect(screen.queryByText('A metni')).toBeNull();
});

test('rejects another meeting or analysis result', () => {
  const value = { meetingId: 'A', analysisRunId: 'run', transcript: 'Metin', transcriptSha256: 'a'.repeat(64) };
  expect(parseSavedTranscript(value, 'A', 'run').text).toBe('Metin');
  expect(() => parseSavedTranscript(value, 'B', 'run')).toThrow();
  expect(() => parseSavedTranscript(value, 'A', 'other')).toThrow();
});

test('virtualizes long saved text without dropping or changing characters', async () => {
  const original = ('Zeynep görevini hazırlayacak. 📝\n').repeat(1000);
  const load = jest.fn().mockResolvedValue(doc(original));
  const screen = render(<SavedTranscript meetingId="A" load={load} />);
  await waitFor(() => expect(screen.UNSAFE_getByType(FlatList)).toBeTruthy());
  fireEvent.press(screen.getByText('Orijinal metni göster'));
  const chunks = (screen.UNSAFE_getByType(FlatList).props.data as SavedTranscriptRow[]).map(row => row.text);
  expect(chunks.length).toBeGreaterThan(4);
  expect(chunks.join('')).toBe(original);
  expect(chunks.every(chunk => Array.from(chunk).length <= 2000)).toBe(true);
  await act(async () => fireEvent.press(screen.getByText('Metnin tamamını kopyala')));
  expect(resultExporter.copy).toHaveBeenCalledWith(original, expect.any(Function));
  expect(screen.getByText('Metnin tamamı kopyalandı.')).toBeTruthy();
});

test('PDF includes the full immutable saved text and cancels its meeting scope on navigation', async () => {
  const screen = render(<SavedTranscript meetingId="A" load={async () => doc('<b>Zeynep</b> 📝\nSon cümle.')} />);
  await waitFor(() => expect(screen.getByText('Kaydedilmiş metni PDF olarak paylaş')).toBeTruthy());
  fireEvent.press(screen.getByText('Orijinal metni göster'));
  await act(async () => fireEvent.press(screen.getByText('Kaydedilmiş metni PDF olarak paylaş')));
  const [html, current] = jest.mocked(resultExporter.pdf).mock.calls[0];
  expect(html).toContain('&lt;b&gt;Zeynep&lt;/b&gt; 📝\nSon cümle.');
  expect(current()).toBe(true);
  screen.rerender(<SavedTranscript meetingId="B" load={async () => doc('B', 'B')} />);
  expect(current()).toBe(false);
  await act(async () => {});
});

test('rejects a transcript response after the account changed', async () => {
  let resolve!: (text: SavedTranscriptDocument) => void;
  const screen = render(<SavedTranscript meetingId="A" load={() => new Promise(done => { resolve = done; })} />);
  jest.mocked(mobileSession.contentScope).mockReturnValue(2);
  await act(async () => resolve(doc('Önceki hesabın metni')));
  expect(screen.queryByText('Önceki hesabın metni')).toBeNull();
  expect(screen.queryByText('Metnin tamamını kopyala')).toBeNull();
});

test('keeps the header mounted and editable while the transcript loads or fails', async () => {
  function Header() { const [value, setValue] = useState(''); return <TextInput accessibilityLabel="Toplantı adı" value={value} onChangeText={setValue} />; }
  let resolve!: (value: SavedTranscriptDocument) => void;
  const screen = render(<SavedTranscript meetingId="A" header={<Header />} load={() => new Promise(done => { resolve = done; })} />);
  fireEvent.changeText(screen.getByLabelText('Toplantı adı'), 'Yazılmakta olan ad');
  await act(async () => resolve(doc('Tam\nmetin.')));
  expect(screen.getByLabelText('Toplantı adı').props.value).toBe('Yazılmakta olan ad');
  expect(screen.getByText('Tam metin.')).toBeTruthy();
  screen.rerender(<SavedTranscript meetingId="B" header={<Header />} load={async () => { throw new Error('404'); }} />);
  await waitFor(() => expect(screen.getByText('Yeniden dene')).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('Toplantı adı'), 'Başka toplantı');
  expect(screen.getByLabelText('Toplantı adı').props.value).toBe('Başka toplantı');
  expect(screen.getByTestId('saved-transcript-list')).toBeTruthy();
});

test('keeps the export snapshot and disables mode changes until the share operation ends', async () => {
  let done!: () => void;
  jest.mocked(resultExporter.pdf).mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  const screen = render(<SavedTranscript meetingId="A" load={async () => doc('Tam\nmetin.')} />);
  await waitFor(() => expect(screen.getByText('Tam metin.')).toBeTruthy());
  fireEvent.press(screen.getByText('Kaydedilmiş metni PDF olarak paylaş'));
  expect(screen.getByRole('button', { name: 'Orijinal metni göster' })).toBeDisabled();
  fireEvent.press(screen.getByText('Orijinal metni göster'));
  expect(screen.getByText('Tam metin.')).toBeTruthy();
  expect(jest.mocked(resultExporter.pdf).mock.calls.at(-1)?.[0]).toContain('Tam metin.');
  await act(async () => done());
  fireEvent.press(screen.getByText('Orijinal metni göster'));
  expect(screen.getByText('Tam\nmetin.')).toBeTruthy();
});
