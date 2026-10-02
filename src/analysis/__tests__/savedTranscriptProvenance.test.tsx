import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SavedTranscript } from '../SavedTranscriptPanel';
import { parseSavedTranscript, type SavedTranscriptDocument } from '../savedTranscript';
import { resultExporter } from '../nativeResultExport';
import { persistedResult, savedTranscript } from '../../audio/liveTestApi';
jest.mock('../../audio/liveTestApi', () => ({ savedTranscript: jest.fn(), persistedResult: jest.fn() }));
jest.mock('../../auth/mobileSession', () => ({ mobileSession: { contentScope: jest.fn(() => 1) } }));
jest.mock('../nativeResultExport', () => ({ resultExporter: { copy: jest.fn().mockResolvedValue(undefined), pdf: jest.fn().mockResolvedValue(undefined) } }));

const response = { meetingId: 'A', analysisRunId: 'run-A', transcript: '  Zeynep\nhazırlayacak. 📝', transcriptSha256: 'a'.repeat(64) };
const incomplete = { recordingOutcome: 'INCOMPLETE' as const, recordingIncompleteReason: 'CLOSURE_UNCONFIRMED' as const };
const unknown = { recordingOutcome: 'UNKNOWN' as const, recordingIncompleteReason: null };
const finished = { recordingOutcome: 'FINISHED' as const, recordingIncompleteReason: null };
const incompleteNotice = 'Bu metin eksik kapatılan kayıttan alındı; konuşmanın tamamını kapsamayabilir.';
const unknownNotice = 'Bu kaydın kapanış durumu doğrulanamadı; metin konuşmanın tamamını kapsamayabilir.';
beforeEach(() => jest.clearAllMocks());

test.each([{}, unknown, finished, incomplete, { recordingOutcome: 'FINISHED' }, { recordingOutcome: 'UNKNOWN' }])(
  'retains the exact transcript occurrence closure without changing its source (%p)', fields => {
    const payload = { ...response, ...fields }, before = JSON.stringify(payload);
    const document = parseSavedTranscript(payload, 'A', 'run-A');
    expect(document).toMatchObject({ text: response.transcript, transcriptSha256: response.transcriptSha256,
      recordingOutcome: 'recordingOutcome' in fields ? fields.recordingOutcome : 'UNKNOWN',
      recordingIncompleteReason: 'recordingIncompleteReason' in fields ? fields.recordingIncompleteReason : null });
    expect(JSON.stringify(payload)).toBe(before);
  });

test.each([
  { recordingOutcome: null }, { recordingOutcome: undefined }, { recordingOutcome: 1 }, { recordingOutcome: 'COMPLETE' },
  { recordingOutcome: 'INCOMPLETE' }, { recordingOutcome: 'INCOMPLETE', recordingIncompleteReason: null },
  { recordingOutcome: 'INCOMPLETE', recordingIncompleteReason: 'OTHER' },
  { recordingOutcome: 'FINISHED', recordingIncompleteReason: 'CLOSURE_UNCONFIRMED' },
  { recordingOutcome: 'UNKNOWN', recordingIncompleteReason: 'CLOSURE_UNCONFIRMED' },
  { recordingOutcome: 'UNKNOWN', recordingIncompleteReason: undefined },
  { recordingIncompleteReason: null }, { recordingIncompleteReason: undefined }, { recordingIncompleteReason: 'CLOSURE_UNCONFIRMED' },
])('withholds malformed transcript closure evidence (%p)', fields => {
  expect(() => parseSavedTranscript({ ...response, ...fields }, 'A', 'run-A')).toThrow('doğrulanamadı');
});

test('inherited outcome or reason cannot authorize an incomplete source', () => {
  for (const payload of [
    Object.assign(Object.create({ recordingIncompleteReason: 'CLOSURE_UNCONFIRMED' }), response, { recordingOutcome: 'INCOMPLETE' }),
    Object.assign(Object.create({ recordingOutcome: 'INCOMPLETE' }), response, { recordingIncompleteReason: 'CLOSURE_UNCONFIRMED' }),
  ]) expect(() => parseSavedTranscript(payload, 'A', 'run-A')).toThrow('doğrulanamadı');
});

test.each([[incomplete, incompleteNotice], [unknown, unknownNotice]] as const)(
  'retains the selected occurrence notice in screen, copy and PDF, in either text mode (%p)', async (fields, notice) => {
    const document = { ...parseSavedTranscript(response, 'A', 'run-A'), ...fields };
    const before = JSON.stringify(document);
    const screen = render(<SavedTranscript meetingId="A" load={async () => document} />);
    await waitFor(() => expect(screen.getByText(notice)).toBeTruthy());
    for (const body of ['  Zeynep hazırlayacak. 📝', response.transcript]) {
      if (body === response.transcript) fireEvent.press(screen.getByText('Orijinal metni göster'));
      expect(screen.getByText(body).props.selectable).toBe(true);
      await act(async () => fireEvent.press(screen.getByText('Metnin tamamını kopyala')));
      expect(resultExporter.copy).toHaveBeenLastCalledWith(`Kayıt bilgisi\n${notice}\n\nKonuşma metni\n${body}`, expect.any(Function));
      await act(async () => fireEvent.press(screen.getByText('Kaydedilmiş metni PDF olarak paylaş')));
      const html = jest.mocked(resultExporter.pdf).mock.calls.at(-1)?.[0];
      expect(html).toContain(`<p class="notice">${notice}</p>`);
      expect(html).toContain(`<h2>Konuşma metni</h2><p>${body}</p>`);
    }
    expect(JSON.stringify(document)).toBe(before);
  });

test('empty legacy text still has an unknown notice and no invented content or export', async () => {
  const screen = render(<SavedTranscript meetingId="A" load={async () => parseSavedTranscript({ ...response, transcript: '' }, 'A', 'run-A')} />);
  await waitFor(() => expect(screen.getByText(unknownNotice)).toBeTruthy());
  expect(screen.getByText('Bu sonuçta konuşma metni boş.')).toBeTruthy();
  expect(screen.queryByText('Metnin tamamını kopyala')).toBeNull();
});

test('finished exact transcript does not inherit meeting-wide or latest-result incompleteness', async () => {
  const document = { ...parseSavedTranscript(response, 'A', 'run-A'), ...finished };
  jest.mocked(persistedResult).mockResolvedValue({ analysisRunId: 'run-A', recordingOutcome: 'INCOMPLETE', incompleteRecordingCount: 2 } as never);
  jest.mocked(savedTranscript).mockResolvedValue(document);
  const screen = render(<SavedTranscript meetingId="A" />);
  await waitFor(() => expect(screen.getByText('Metnin tamamını kopyala')).toBeTruthy());
  expect(savedTranscript).toHaveBeenCalledWith('A', 'run-A');
  expect(screen.queryByText(incompleteNotice)).toBeNull();
  expect(screen.queryByText(unknownNotice)).toBeNull();
  await act(async () => fireEvent.press(screen.getByText('Metnin tamamını kopyala')));
  expect(resultExporter.copy).toHaveBeenLastCalledWith('  Zeynep hazırlayacak. 📝', expect.any(Function));
  await act(async () => fireEvent.press(screen.getByText('Kaydedilmiş metni PDF olarak paylaş')));
  expect(jest.mocked(resultExporter.pdf).mock.calls.at(-1)?.[0]).not.toMatch(/eksiksiz|eksik kapatılan|doğrulanamadı/);
});

test('malformed evidence from an alternate loader cannot display or export text', async () => {
  const document = { meetingId: 'A', analysisRunId: 'run-A', text: 'Gösterilmemeli', ...incomplete, recordingIncompleteReason: null } as unknown as SavedTranscriptDocument;
  const screen = render(<SavedTranscript meetingId="A" load={async () => document} />);
  await waitFor(() => expect(screen.getByText('Yeniden dene')).toBeTruthy());
  expect(screen.queryByText('Gösterilmemeli')).toBeNull();
  expect(screen.queryByText('Metnin tamamını kopyala')).toBeNull();
});

test('an older alternate loader is normalized to unknown before showing or sharing its text', async () => {
  const document = { meetingId: 'A', analysisRunId: 'run-A', text: 'Eski metin' } as SavedTranscriptDocument;
  const screen = render(<SavedTranscript meetingId="A" load={async () => document} />);
  await waitFor(() => expect(screen.getByText(unknownNotice)).toBeTruthy());
  await act(async () => fireEvent.press(screen.getByText('Metnin tamamını kopyala')));
  expect(resultExporter.copy).toHaveBeenLastCalledWith(`Kayıt bilgisi\n${unknownNotice}\n\nKonuşma metni\nEski metin`, expect.any(Function));
  expect(document).not.toHaveProperty('recordingOutcome');
});
