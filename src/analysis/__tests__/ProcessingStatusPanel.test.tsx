import { act, fireEvent, render } from '@testing-library/react-native';
import { ProcessingStatusPanel, recordingChoiceLabel } from '../ProcessingStatusPanel';
import { parseProcessingStatus, ProcessingStatusReadError } from '../processingStatus';
import { choices, finalizedWire, meetingId, secondSessionId, sessionId, wireStatus } from '../testFixtures/processingStatus.fixture';
import { mobileSession } from '../../auth/mobileSession';
jest.mock('../../auth/mobileSession', () => ({ mobileSession: { contentScope: jest.fn(() => 1) } }));
jest.mock('../../audio/liveTestApi', () => ({ recordingChoices: jest.fn(), processingStatus: jest.fn() }));
const status = (id = sessionId) => parseProcessingStatus(wireStatus(id), meetingId, id);
const final = () => parseProcessingStatus(finalizedWire(), meetingId, sessionId);
const list = () => jest.fn().mockResolvedValue(choices);
const tick = async () => { await act(async () => {}); };
beforeEach(() => { jest.mocked(mobileSession.contentScope).mockReturnValue(1); });

test('is lazy, requires explicit selection, uses date seconds and labels creation fallback', async () => {
  const loadChoices = list(), loadStatus = jest.fn().mockResolvedValue(status());
  const ui = render(<ProcessingStatusPanel meetingId={meetingId} loadChoices={loadChoices} loadStatus={loadStatus} />);
  expect(loadChoices).not.toHaveBeenCalled();
  fireEvent.press(ui.getByText('Kayıt durumunu kontrol et')); await tick();
  expect(loadStatus).not.toHaveBeenCalled();
  expect(ui.getByText(/Oluşturulma: 2026-09-25 18:47:07 \(UTC\)/)).toBeTruthy();
  fireEvent.press(ui.getByText(recordingChoiceLabel(choices[0], 0))); await tick();
  expect(loadStatus).toHaveBeenCalledWith(meetingId, sessionId, 1);
  expect(ui.getByText('Sunucu bu kaydın kapanışını henüz doğrulamamış.')).toBeTruthy();
  expect(ui.getByText(/Metin durumu kontrolü: 2026-09-26 18:47:07/)).toBeTruthy();
  expect(ui.getByText(/Kaydedilmiş sonuç kontrolü: 2026-09-26 18:47:08/)).toBeTruthy();
});
test.each([403, 404, 409, 410, 423, 503])('clears previous status before refresh and safely handles HTTP %s', async code => {
  const loadStatus = jest.fn().mockResolvedValueOnce(final()).mockRejectedValueOnce(new ProcessingStatusReadError(code));
  const ui = render(<ProcessingStatusPanel meetingId={meetingId} loadChoices={list()} loadStatus={loadStatus} />);
  fireEvent.press(ui.getByText('Kayıt durumunu kontrol et')); await tick();
  fireEvent.press(ui.getByText(recordingChoiceLabel(choices[0], 0))); await tick();
  expect(ui.getByText('Kaydedilmiş analiz sonucu bu metin sürümüyle eşleşiyor.')).toBeTruthy();
  fireEvent.press(ui.getByText('Seçili kaydın durumunu yenile'));
  expect(ui.queryByText('Seçili kaydın durumu')).toBeNull(); await tick();
  expect(ui.getByText(new ProcessingStatusReadError(code).message)).toBeTruthy();
  expect(ui.queryByText(/Bu kayıt için kaydedilmiş analiz sonucu bulunmuyor/)).toBeNull();
});
test.each(['success', 'error'])('late %s from a previous selection cannot overwrite the next selection', async outcome => {
  let resolve!: (value: ReturnType<typeof status>) => void, reject!: (error: Error) => void;
  const loadStatus = jest.fn().mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }))
    .mockResolvedValueOnce(status(secondSessionId));
  const ui = render(<ProcessingStatusPanel meetingId={meetingId} loadChoices={list()} loadStatus={loadStatus} />);
  fireEvent.press(ui.getByText('Kayıt durumunu kontrol et')); await tick();
  fireEvent.press(ui.getByText(recordingChoiceLabel(choices[0], 0)));
  fireEvent.press(ui.getByText(recordingChoiceLabel(choices[1], 1))); await tick();
  await act(async () => { if (outcome === 'success') resolve(final()); else reject(new ProcessingStatusReadError(410)); });
  expect(ui.getByText('Sunucu bu kaydın kapanışını henüz doğrulamamış.')).toBeTruthy();
  expect(ui.queryByText('Kaydedilmiş analiz sonucu bu metin sürümüyle eşleşiyor.')).toBeNull();
  expect(ui.queryByText(/silinmiş/)).toBeNull();
});
test('meeting switch drops late result and resets the picker', async () => {
  let resolve!: (value: ReturnType<typeof status>) => void;
  const loadStatus = jest.fn(() => new Promise<ReturnType<typeof status>>(yes => { resolve = yes; }));
  const ui = render(<ProcessingStatusPanel meetingId={meetingId} loadChoices={list()} loadStatus={loadStatus} />);
  fireEvent.press(ui.getByText('Kayıt durumunu kontrol et')); await tick();
  fireEvent.press(ui.getByText(recordingChoiceLabel(choices[0], 0)));
  ui.rerender(<ProcessingStatusPanel meetingId={secondSessionId} loadChoices={list()} loadStatus={loadStatus} />);
  await act(async () => resolve(final()));
  expect(ui.queryByText('Seçili kaydın durumu')).toBeNull();
  expect(ui.getByText('Kayıt durumunu kontrol et')).toBeTruthy();
});
test.each(['success', 'error'])('account changes during %s clear metadata even without a parent rerender', async outcome => {
  let resolve!: (value: ReturnType<typeof status>) => void, reject!: (error: Error) => void;
  const loadStatus = jest.fn(() => new Promise<ReturnType<typeof status>>((yes, no) => { resolve = yes; reject = no; }));
  const ui = render(<ProcessingStatusPanel meetingId={meetingId} loadChoices={list()} loadStatus={loadStatus} />);
  fireEvent.press(ui.getByText('Kayıt durumunu kontrol et')); await tick();
  fireEvent.press(ui.getByText(recordingChoiceLabel(choices[0], 0)));
  jest.mocked(mobileSession.contentScope).mockReturnValue(2);
  await act(async () => { if (outcome === 'success') resolve(final()); else reject(new ProcessingStatusReadError(410)); });
  expect(ui.queryByText(recordingChoiceLabel(choices[0], 0))).toBeNull();
  expect(ui.queryByText('Seçili kaydın durumu')).toBeNull();
  expect(ui.getByText('Oturum değişti; kayıt durumunu yeniden açın.')).toBeTruthy();
});
test('account rerender removes an already loaded result', async () => {
  const props = { meetingId, loadChoices: list(), loadStatus: jest.fn().mockResolvedValue(final()) };
  const ui = render(<ProcessingStatusPanel {...props} />);
  fireEvent.press(ui.getByText('Kayıt durumunu kontrol et')); await tick();
  fireEvent.press(ui.getByText(recordingChoiceLabel(choices[0], 0))); await tick();
  jest.mocked(mobileSession.contentScope).mockReturnValue(2); ui.rerender(<ProcessingStatusPanel {...props} />);
  expect(ui.queryByText('Seçili kaydın durumu')).toBeNull();
});
test('old recordings remain explicitly reachable past the first page', async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({ ...choices[0], id: `${sessionId.slice(0, -3)}${String(index).padStart(3, '0')}` }));
  const loadStatus = jest.fn().mockResolvedValue(status(rows[20].id));
  const ui = render(<ProcessingStatusPanel meetingId={meetingId} loadChoices={jest.fn().mockResolvedValue(rows)} loadStatus={loadStatus} />);
  fireEvent.press(ui.getByText('Kayıt durumunu kontrol et')); await tick();
  expect(ui.queryByText(recordingChoiceLabel(rows[20], 20))).toBeNull();
  fireEvent.press(ui.getByText('Daha eski kayıtları göster'));
  fireEvent.press(ui.getByText(recordingChoiceLabel(rows[20], 20))); await tick();
  expect(loadStatus).toHaveBeenCalledWith(meetingId, rows[20].id, 1);
});
