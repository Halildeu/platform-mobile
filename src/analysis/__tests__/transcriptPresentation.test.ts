import { presentSavedTranscript, readableTranscriptText } from '../transcriptPresentation';
import { savedTranscriptRows, type SavedTranscriptDocument, type SavedTranscriptSegment } from '../savedTranscript';

const segment = (text: string, scope = 'scope-A', speaker = 'S1'): SavedTranscriptSegment => ({ text,
  speakerAttribution: { scope, turns: [{ speaker, textStart: 0, textEnd: text.length, startMs: 0, endMs: 1000 }] } });
const doc = (segments: SavedTranscriptSegment[]): SavedTranscriptDocument => ({
  meetingId: 'A', analysisRunId: 'run-A', transcriptSha256: 'a'.repeat(64),
  text: segments.filter(item => item.text !== null).map(item => item.text).join('\n'), segments,
});

test('joins line separators and standalone punctuation, keeping paragraphs, words, numbers and spaces', () => {
  const source = '  Bu\r\ntoplantı\n📝\n.\r\n\r\n2006\ngünü  saat\n2\'de\n3\n.14\nkontrollü edecek.\nHenüz\nbitmedi.';
  expect(readableTranscriptText(source)).toBe("  Bu toplantı 📝.\r\n\r\n2006 günü  saat 2'de 3 .14 kontrollü edecek. Henüz bitmedi.");
  expect(readableTranscriptText(source).replace(/\s/g, '')).toBe(source.replace(/\s/g, ''));
  expect(readableTranscriptText('A \nB\n C')).toBe('A B C');
  expect(readableTranscriptText('A\n \t\nB')).toBe('A\n \t\nB');
});

test('merges adjacent known fragments only inside the same speaker scope', () => {
  const document = doc([segment('Sunum'), segment('hazır.'), segment('Bütçe', 'scope-A', 'S2'),
    segment('hazır.', 'scope-A', 'S2'), segment('Son.', 'scope-B')]);
  const unchanged = JSON.stringify(document);
  const view = presentSavedTranscript(document);
  expect(view.rows.map(row => row.text)).toEqual(['Sunum hazır.', '\nBütçe hazır.', '\nSon.']);
  expect(view.rows.map(row => row.speaker)).toEqual([1, 2, 3]);
  expect(view.rows.map(row => row.speakerKey?.scope)).toEqual(['scope-A', 'scope-A', 'scope-B']);
  expect(view.text).toBe(view.rows.map(row => row.text).join(''));
  expect(JSON.stringify(document)).toBe(unchanged);
  expect(presentSavedTranscript(document, true)).toEqual({ text: document.text, rows: savedTranscriptRows(document) });
});

test('unknown, missing, redacted and blank paragraph boundaries do not join speakers', () => {
  const document = doc([segment('A'), segment('?', 'scope-A', 'UU'), segment('B'), { text: 'eksik' },
    segment('C'), { text: null }, segment('D\n'), segment('E')]);
  const view = presentSavedTranscript(document);
  expect(view.rows.map(row => row.speaker)).toEqual([1, 'unknown', 1, undefined, 1, 1, 1]);
  expect(view.text).toBe('A\n?\nB\neksik\nC\nD\n\nE');
  expect(view.text.replace(/\s/g, '')).toBe(document.text.replace(/\s/g, ''));
});

test('long readable text is virtualized without splitting emoji or changing source offsets', () => {
  const document = doc([segment(('📝 sözcük\n').repeat(10000))]);
  const raw = JSON.stringify(document);
  const view = presentSavedTranscript(document);
  expect(view.rows.length).toBeGreaterThan(4);
  expect(view.rows.every(row => Array.from(row.text).length <= 2000)).toBe(true);
  expect(view.rows.slice(0, -1).every(row => /\s$/u.test(row.text))).toBe(true);
  expect(view.rows.map(row => row.text).join('')).toBe(view.text);
  expect(view.text.replace(/\s/g, '')).toBe(document.text.replace(/\s/g, ''));
  expect(view.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  expect(JSON.stringify(document)).toBe(raw);
});

test('handles legacy payloads, empty text and CRLF on a virtualization boundary', () => {
  expect(presentSavedTranscript({ meetingId: 'A', analysisRunId: 'run', text: 'Bu\nmetin.' }).text).toBe('Bu metin.');
  expect(presentSavedTranscript(doc([]))).toEqual({ text: '', rows: [] });
  const source = 'A'.repeat(1999) + '\r\nB';
  expect(presentSavedTranscript(doc([segment(source)])).text).toBe('A'.repeat(1999) + ' B');
});

test.each([false, true])('unknown or unattributed long turns do not gain separators at viewport chunks (%s)', unknown => {
  const word = 'x'.repeat(4001);
  const document = doc([segment('Başlangıç'), unknown ? segment(word, 'scope-A', 'UU') : { text: word }]);
  const view = presentSavedTranscript(document);
  expect(view.rows.length).toBeGreaterThan(2);
  expect(view.text).toBe('Başlangıç\n' + word);
  expect(view.rows.map(row => row.text).join('')).toBe(view.text);
});
