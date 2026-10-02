import { clearMeetingViews, readMeetingView, saveMeetingView } from '../meetingViewCache';
afterEach(() => { clearMeetingViews(); jest.useRealTimers(); });
it('keeps meeting views separate and clears them on logout', () => {
  saveMeetingView('A', { lines: [], analysis: null, diagnostics: ['A report'] });
  expect(readMeetingView('B')).toBeUndefined();
  expect(readMeetingView('A')?.diagnostics).toEqual(['A report']);
  clearMeetingViews();
  expect(readMeetingView('A')).toBeUndefined();
});
it('expires navigation data and bounds the number of meetings', () => {
  jest.useFakeTimers();
  for (let i = 0; i < 6; i++) saveMeetingView(String(i), { lines: [], analysis: null, diagnostics: [] });
  expect(readMeetingView('0')).toBeUndefined();
  jest.advanceTimersByTime(3600001);
  expect(readMeetingView('5')).toBeUndefined();
});
