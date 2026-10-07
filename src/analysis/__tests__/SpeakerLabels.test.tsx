import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { SavedSpeakerTranscript } from '../SavedSpeakerTranscript';
import { normalizeSpeakerName, parseSpeakerLabels, type SpeakerLabels } from '../speakerLabels';
import { savedTranscriptRows, type SavedTranscriptDocument } from '../savedTranscript';
import { mobileSession } from '../../auth/mobileSession';
jest.mock('../../audio/liveTestApi', () => ({ savedSpeakerLabels: jest.fn() }));
jest.mock('../../auth/mobileSession', () => ({ mobileSession: { contentScope: jest.fn(() => 1) } }));
const id = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const doc: SavedTranscriptDocument = { meetingId: id(1), analysisRunId: id(2), sessionId: id(3),
  recordingOutcome: 'UNKNOWN', recordingIncompleteReason: null,
  finalizationVersion: 1, transcriptSha256: 'a'.repeat(64), text: 'Bir. İki.', segments: [{ text: 'Bir. İki.',
    speakerAttribution: { scope: id(4), turns: [
      { speaker: 'S7', textStart: 0, textEnd: 4, startMs: 0, endMs: 400 },
      { speaker: 'S2', textStart: 5, textEnd: 9, startMs: 400, endMs: 800 }] } }] };
const empty: SpeakerLabels = { revision: 0, editable: true, labels: [] };
const saved: SpeakerLabels = { revision: 1, editable: true, labels: [{ scope: id(4), speaker: 'S7', name: 'Zeynep' }] };
const wire = () => ({ ...empty, meetingId: doc.meetingId, analysisRunId: doc.analysisRunId,
  sessionId: doc.sessionId, finalizationVersion: 1, transcriptSha256: doc.transcriptSha256 });
beforeEach(() => { jest.clearAllMocks(); jest.mocked(mobileSession.contentScope).mockReturnValue(1); });

test('normalizes Unicode spaces consistently and rejects controls, bidi and broken UTF-16', () => {
  expect(normalizeSpeakerName('\u00a0Zeynep\u2003')).toBe('Zeynep');
  expect(normalizeSpeakerName('😀'.repeat(80))).toHaveLength(160);
  for (const value of ['', ' ', 'x'.repeat(81), '\nA', 'A\u202e', '\ud800', 'A\u2028', ' '.repeat(161) + 'A'])
    expect(() => normalizeSpeakerName(value)).toThrow();
});
test('rejects wrong occurrence, revision and unknown or duplicate speaker keys', () => {
  for (const mutation of [{ meetingId: id(5) }, { analysisRunId: id(5) }, { sessionId: id(5) },
    { finalizationVersion: 2 }, { transcriptSha256: 'b'.repeat(64) }, { revision: -1 },
    { revision: Number.MAX_SAFE_INTEGER + 1 }, { labels: [{ ...saved.labels[0], scope: id(5) }] },
    { labels: [{ ...saved.labels[0], speaker: 'UU' }] }, { labels: [saved.labels[0], saved.labels[0]] },
    { labels: Array(257).fill(saved.labels[0]) }, { labels: [{ ...saved.labels[0], name: '\u00a0A' }] }])
    expect(() => parseSpeakerLabels({ ...wire(), ...mutation }, doc)).toThrow();
  const two = [{ ...saved.labels[0], name: 'A' }, { ...saved.labels[0], speaker: 'S2', name: 'A' }];
  expect(parseSpeakerLabels({ ...wire(), labels: two }, doc).labels).toHaveLength(2);
});
test('edits the stored identity, survives reopen, removes one name, and preserves text', async () => {
  const api = jest.fn().mockResolvedValueOnce(empty).mockResolvedValueOnce(saved).mockResolvedValueOnce(saved)
    .mockResolvedValueOnce({ ...empty, revision: 2 });
  let screen = render(<SavedSpeakerTranscript document={doc} owner={1} api={api} />);
  await waitFor(() => expect(screen.getByLabelText('Konuşmacı 1 adını düzenle')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Konuşmacı 1 adını düzenle'));
  fireEvent.changeText(screen.getByLabelText('Konuşmacı adı'), ' Zeynep ');
  fireEvent.press(screen.getByText('Adı kaydet'));
  await waitFor(() => expect(screen.getByText('Zeynep')).toBeTruthy());
  expect(api).toHaveBeenNthCalledWith(2, doc, 1, { scope: id(4), speaker: 'S7', name: 'Zeynep', expectedRevision: 0 });
  expect(screen.getByText('Bir.').props.selectable).toBe(true);
  screen.unmount(); screen = render(<SavedSpeakerTranscript document={doc} owner={1} api={api} />);
  await waitFor(() => expect(screen.getByText('Zeynep')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Konuşmacı 1 adını düzenle'));
  fireEvent.press(screen.getByText('Adı kaldır'));
  await waitFor(() => expect(screen.getByText('Konuşmacı adı kaldırıldı.')).toBeTruthy());
  expect(api).toHaveBeenLastCalledWith(doc, 1, { scope: id(4), speaker: 'S7', name: null, expectedRevision: 1 });
  expect(screen.queryByText('Zeynep')).toBeNull();
});
test.each(['lost response', 'revision conflict'])('%s reads back and never blindly repeats PUT', async () => {
  const api = jest.fn().mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('uncertain')).mockResolvedValueOnce(saved);
  const screen = render(<SavedSpeakerTranscript document={doc} owner={1} api={api} />);
  await waitFor(() => expect(screen.getByLabelText('Konuşmacı 1 adını düzenle')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Konuşmacı 1 adını düzenle'));
  fireEvent.changeText(screen.getByLabelText('Konuşmacı adı'), 'Zeynep');
  fireEvent.press(screen.getByText('Adı kaydet'));
  await waitFor(() => expect(screen.getByText(/İşlem sonucu kesinleştirilemedi/)).toBeTruthy());
  expect(screen.queryByText('Konuşmacı adı kaydedildi.')).toBeNull();
  expect(api.mock.calls.filter(call => call[2])).toHaveLength(1);
  expect(api).toHaveBeenLastCalledWith(doc, 1);
  expect(screen.getByText('Zeynep')).toBeTruthy();
});
test('double tap sends one mutation and late response cannot update another occurrence', async () => {
  let finish!: (value: SpeakerLabels) => void;
  const api = jest.fn().mockResolvedValueOnce(empty).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(empty);
  const screen = render(<SavedSpeakerTranscript document={doc} owner={1} api={api} />);
  await waitFor(() => expect(screen.getByLabelText('Konuşmacı 1 adını düzenle')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Konuşmacı 1 adını düzenle'));
  fireEvent.changeText(screen.getByLabelText('Konuşmacı adı'), 'Zeynep');
  act(() => { fireEvent.press(screen.getByText('Adı kaydet')); fireEvent.press(screen.getByText('Adı kaydet')); });
  expect(api.mock.calls.filter(call => call[2])).toHaveLength(1);
  screen.rerender(<SavedSpeakerTranscript document={{ ...doc, analysisRunId: id(5) }} owner={1} api={api} />);
  await act(async () => finish(saved));
  expect(screen.queryByText('Zeynep')).toBeNull();
  expect(screen.queryByText('Konuşmacı adı kaydedildi.')).toBeNull();
});
test('account change rejects late names and makes old editor inert', async () => {
  let finish!: (value: SpeakerLabels) => void;
  const api = jest.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const screen = render(<SavedSpeakerTranscript document={doc} owner={1} api={api} />);
  jest.mocked(mobileSession.contentScope).mockReturnValue(2);
  await act(async () => finish(saved));
  expect(screen.queryByText('Zeynep')).toBeNull();
  expect(screen.queryByText('Adı düzenle')).toBeNull();
});

test.each([
  { analysisRunId: id(5) },
  { sessionId: id(5) },
  { finalizationVersion: 2 },
  { transcriptSha256: 'b'.repeat(64) },
])('a stable view key cannot retain names or edit permission across occurrence changes: %j', async changed => {
  let rejectNext!: (reason: Error) => void;
  const api = jest.fn().mockResolvedValueOnce(saved)
    .mockImplementationOnce(() => new Promise((_, reject) => { rejectNext = reject; }));
  const screen = render(<SavedSpeakerTranscript viewKey="same-view" document={doc} owner={1} api={api} />);
  await waitFor(() => expect(screen.getByText('Zeynep')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Konuşmacı 1 adını düzenle'));
  fireEvent.changeText(screen.getByLabelText('Konuşmacı adı'), 'Eski taslak');
  screen.rerender(<SavedSpeakerTranscript viewKey="same-view" document={{ ...doc, ...changed }} owner={1} api={api} />);
  expect(screen.queryByText('Zeynep')).toBeNull();
  expect(screen.queryByLabelText('Konuşmacı adı')).toBeNull();
  expect(screen.queryByText('Adı düzenle')).toBeNull();
  await act(async () => rejectNext(new Error('unavailable')));
  expect(screen.queryByText('Zeynep')).toBeNull();
  expect(screen.queryByText('Adı düzenle')).toBeNull();
  expect(screen.getByText('Bir.')).toBeTruthy();
});

test('a stable view key does not carry a pending save lock into the next occurrence', async () => {
  let finishOldSave!: (value: SpeakerLabels) => void;
  const api = jest.fn().mockResolvedValueOnce(empty)
    .mockImplementationOnce(() => new Promise(resolve => { finishOldSave = resolve; }))
    .mockResolvedValueOnce(empty).mockResolvedValueOnce(saved);
  const screen = render(<SavedSpeakerTranscript viewKey="same-view" document={doc} owner={1} api={api} />);
  await waitFor(() => expect(screen.getByLabelText('Konuşmacı 1 adını düzenle')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Konuşmacı 1 adını düzenle'));
  fireEvent.changeText(screen.getByLabelText('Konuşmacı adı'), 'Eski ad');
  fireEvent.press(screen.getByText('Adı kaydet'));
  const next = { ...doc, analysisRunId: id(5) };
  screen.rerender(<SavedSpeakerTranscript viewKey="same-view" document={next} owner={1} api={api} />);
  await waitFor(() => expect(api).toHaveBeenNthCalledWith(3, next, 1));
  await act(async () => finishOldSave(saved));
  fireEvent.press(screen.getByLabelText('Konuşmacı 1 adını düzenle'));
  expect(screen.getByLabelText('Konuşmacı adı')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Konuşmacı adı'), 'Zeynep');
  fireEvent.press(screen.getByText('Adı kaydet'));
  await waitFor(() => expect(api).toHaveBeenNthCalledWith(4, next, 1,
    { scope: id(4), speaker: 'S7', name: 'Zeynep', expectedRevision: 0 }));
});

test('a stable view key cannot retain loaded names when the account changes', async () => {
  const api = jest.fn().mockResolvedValueOnce(saved).mockImplementationOnce(() => new Promise(() => {}));
  const screen = render(<SavedSpeakerTranscript viewKey="same-view" document={doc} owner={1} api={api} />);
  await waitFor(() => expect(screen.getByText('Zeynep')).toBeTruthy());
  jest.mocked(mobileSession.contentScope).mockReturnValue(2);
  screen.rerender(<SavedSpeakerTranscript viewKey="same-view" document={doc} owner={2} api={api} />);
  expect(screen.queryByText('Zeynep')).toBeNull();
  expect(screen.queryByText('Adı düzenle')).toBeNull();
  expect(api).toHaveBeenLastCalledWith(doc, 2);
});

test('an equivalent document refresh does not cancel an in-flight save or leave the editor busy', async () => {
  let finish!: (value: SpeakerLabels) => void;
  const api = jest.fn().mockResolvedValueOnce(empty)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const screen = render(<SavedSpeakerTranscript viewKey="same-view" document={doc} owner={1} api={api} />);
  await waitFor(() => expect(screen.getByLabelText('Konuşmacı 1 adını düzenle')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Konuşmacı 1 adını düzenle'));
  fireEvent.changeText(screen.getByLabelText('Konuşmacı adı'), 'Zeynep');
  fireEvent.press(screen.getByText('Adı kaydet'));
  screen.rerender(<SavedSpeakerTranscript viewKey="same-view" document={{ ...doc }} owner={1} api={api} />);
  await act(async () => finish(saved));
  expect(api).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Konuşmacı adı kaydedildi.')).toBeTruthy();
  expect(screen.getByText('Zeynep')).toBeTruthy();
  expect(screen.getByLabelText('Konuşmacı 1 adını düzenle')).not.toBeDisabled();
  fireEvent.press(screen.getByLabelText('Konuşmacı 1 adını düzenle'));
  expect(screen.getByLabelText('Konuşmacı adı').props.value).toBe('Zeynep');
});

test('legacy text and unknown speakers are still readable without a label request', () => {
  const api = jest.fn();
  const legacy = render(<SavedSpeakerTranscript document={{ ...doc, segments: undefined }} owner={1} api={api} />);
  expect(legacy.getByText(doc.text).props.selectable).toBe(true);
  expect(api).not.toHaveBeenCalled();
});

test('opens the editor beside the selected speaker and clears it when presentation rows change', async () => {
  const api = jest.fn().mockResolvedValue(empty);
  const rows = savedTranscriptRows(doc);
  const screen = render(<SavedSpeakerTranscript document={doc} owner={1} rows={rows} api={api} />);
  await waitFor(() => expect(screen.getByLabelText('Konuşmacı 2 adını düzenle')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Konuşmacı 2 adını düzenle'));
  const rowIndex = rows.findIndex(row => row.speakerKey?.speaker === 'S2');
  expect(within(screen.getByTestId(`saved-transcript-row-${rowIndex}`)).getByLabelText('Konuşmacı adı')).toBeTruthy();
  expect(within(screen.getByTestId('saved-transcript-row-0')).queryByTestId('speaker-name-editor')).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Konuşmacı adı'), 'Mehmet');
  screen.rerender(<SavedSpeakerTranscript document={doc} owner={1} rows={[...rows]} api={api} />);
  expect(screen.queryByLabelText('Konuşmacı adı')).toBeNull();
  expect(api.mock.calls.filter(call => call[2])).toHaveLength(0);
});
