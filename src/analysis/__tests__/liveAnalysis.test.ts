import { AnalysisEvents, newerAnalysis, parseAnalysis } from '../liveAnalysis';
const payload = { version: 1, is_partial: true, grounding_policy: 'verified_only', summary_grounding_status: 'verified', summary: 'Kısa özet', decisions: ['Karar'], action_items: [{ text: 'İncele', owner: null, due_date: null }] };
test('fragmented CRLF event produces one complete snapshot', () => {
  const parser = new AnalysisEvents();
  expect(parser.push('event: analysis\r\ndata: '+JSON.stringify(payload)+'\r')).toEqual([]);
  expect(parser.push('\n\r\n')).toEqual([parseAnalysis(payload)]);
});
test('withheld summary and rejected claims never appear', () => {
  const result = parseAnalysis({ ...payload, summary_grounding_status: 'withheld', rejected_claims: ['unverified'] });
  expect(result?.summary).toBe(''); expect(JSON.stringify(result)).not.toContain('unverified');
  expect(parseAnalysis({ ...payload, grounding_policy: 'unchecked' })).toBeNull();
});
test('older partial cannot replace final analysis', () => {
  const final = parseAnalysis({ ...payload, version: 10, is_partial: false })!;
  expect(newerAnalysis(final, parseAnalysis(payload)!)).toBe(final);
  expect(newerAnalysis(final, parseAnalysis({ ...payload, version: 11 })!)).toBe(final);
});
test('oversized stream is rejected and malformed metadata is not displayed', () => {
  expect(() => new AnalysisEvents().push('x'.repeat(262145))).toThrow();
  expect(parseAnalysis({ ...payload, action_items: [{ text: 'x', owner: {} }] })).toBeNull();
});

test('diagnostics distinguish heartbeat, malformed JSON, rejected schema and unknown events without payloads', () => {
  const parser = new AnalysisEvents();
  const good = 'event: analysis\ndata: ' + JSON.stringify(payload) + '\n\n';
  expect(parser.push(':heart')).toEqual([]);
  expect(parser.push('beat\r\n\r\nevent: analysis\ndata: broken-private-text\n\n' +
    'event: analysis\ndata: {"grounding_policy":"unchecked","secret":"private"}\n\n' +
    'event: unexpected\ndata: private\n\n' + good)).toEqual([parseAnalysis(payload)]);
  expect(parser.diagnostics()).toEqual({ heartbeats: 1, accepted: 1, invalidJson: 1, rejected: 1, unknownEvents: 1, overflows: 0 });
  expect(JSON.stringify(parser.diagnostics())).not.toMatch(/private|unchecked|Karar/);
});
