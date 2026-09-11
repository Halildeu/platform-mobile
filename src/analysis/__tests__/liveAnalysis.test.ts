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
