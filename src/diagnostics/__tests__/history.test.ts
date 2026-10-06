import { DiagnosticHistory, cleanDetails, decodeEntry, type Entry, type HistoryStore } from '../history';
import { messageEvent } from '../messageEvent';

const meeting = '604593c5-9c2d-4c86-bc1d-2aec2270cf99';
test('provider failure codes survive history sanitization but arbitrary messages never do', () => {
  expect(cleanDetails({ serverErrorCode: 'SPEECHMATICS_BUFFER_ERROR' }))
    .toEqual({ serverErrorCode: 'SPEECHMATICS_BUFFER_ERROR' });
  expect(cleanDetails({ serverErrorCode: 'SPEECHMATICS_BUFFER_ERROR PRIVATE', msg: 'PRIVATE' })).toEqual({});
});
function store(): HistoryStore {
  const entries: Entry[] = [];
  return { append: e => { entries.push(e); }, read: id => ({ entries: entries.filter(e => e.meeting === id), removed: 0 }),
    clear: id => { for (let i = entries.length - 1; i >= 0; i--) if (entries[i].meeting === id) entries.splice(i, 1); }, close: jest.fn() };
}
test('whitelists numeric metadata and validated IDs, excludes content and credentials on both write and read', () => {
  const unsafe = { actions: 2, missingOwners: 1, requestId: meeting, sessionId: 'SES-test-1',
    summary: 'PRIVATE', owner: 'PRIVATE', jwt: 'PRIVATE', status: 'PRIVATE', reason: 'PRIVATE', unknownEvents: Infinity };
  expect(cleanDetails(unsafe)).toEqual({ actions: 2, missingOwners: 1, requestId: meeting, sessionId: 'SES-test-1' });
  const raw = JSON.stringify({ at: 1, meeting, kind: 'analysis', data: unsafe });
  expect(JSON.stringify(decodeEntry(raw, meeting))).not.toContain('PRIVATE');
  expect(() => decodeEntry(raw, 'different')).toThrow();
  expect(() => decodeEntry(raw.replace('"analysis"', '"unknown"'), meeting)).toThrow();
});
test('reopens history after a fresh handle, isolates meetings and rejects late callbacks after logout', () => {
  const disk = store(); const first = new DiagnosticHistory(disk);
  first.record(meeting, 'run_started', { runId: meeting }); first.close();
  first.record(meeting, 'capture_failed');
  const next = new DiagnosticHistory(disk);
  expect(next.report(meeting)).toContain('Kayıt denemesi başladı');
  expect(next.report(meeting)).not.toContain('Ses yakalama veya taşıma hatası');
  expect(next.report('00000000-0000-4000-8000-000000000000')).not.toContain('Kayıt denemesi başladı');
  expect(() => first.report(meeting)).toThrow();
  next.clear(meeting); expect(next.report(meeting)).toContain('saklanmış teknik olay bulunmuyor');
});
test('storage failure is visible and cannot break recording callers', () => {
  const disk = store(); disk.append = () => { throw new Error('locked'); };
  const journal = new DiagnosticHistory(disk);
  expect(() => journal.record(meeting, 'capture_started')).not.toThrow();
  expect(journal.report(meeting)).toContain('rapor eksik olabilir');
});

test('validation failures are also contained before any storage operation', () => {
  const journal = new DiagnosticHistory(store());
  const original = Object.hasOwn;
  let escaped = false;
  try {
    Object.hasOwn = () => { throw new Error('injected validation failure'); };
    try { journal.record(meeting, 'run_started'); } catch { escaped = true; }
  } finally { Object.hasOwn = original; }
  expect(escaped).toBe(false);
  expect(journal.failed()).toBe(true);
});

test('detailed setup failures return no capture and never escape into microphone startup', () => {
  const disk = { ...store(), appendDetail: jest.fn() };
  const journal = new DiagnosticHistory(disk, () => { throw new Error('injected clock failure'); });
  expect(journal.beginDetailed(meeting, meeting, 'android', 3600000)).toBeNull();
  expect(journal.failed()).toBe(true);
  expect(disk.appendDetail).not.toHaveBeenCalled();
});

test('an unsuccessful first detailed write is not reported as an enabled capture', () => {
  const journal = new DiagnosticHistory({ ...store(), appendDetail: () => { throw new Error('disk unavailable'); } });
  expect(journal.beginDetailed(meeting, meeting, 'ios', 3600000)).toBeNull();
  expect(journal.failed()).toBe(true);
});
test('malformed stream counters and HTTP correlation survive without arbitrary server content', () => {
  const event = messageEvent('Canlı analiz akışı: bağlantı=2, bayt=413, heartbeat=1, geçerli=3, bozuk JSON=4, sözleşmeye uymayan=5, bilinmeyen olay=6, sınır aşımı=7');
  expect(event?.details).toEqual({ connection: 2, bytes: 413, heartbeat: 1, valid: 3, invalidJson: 4, rejected: 5, unknownEvents: 6, overflows: 7 });
  expect(messageEvent(`Kalıcı toplantı sonucu (404): PRIVATE Takip: ${meeting}.`)).toEqual({ kind: 'request_failed', details: { status: 404, requestId: meeting } });
  expect(messageEvent('PRIVATE')).toBeUndefined();
});
