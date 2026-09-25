import { cleanDetail, decodeDetail, DetailedCapture, DETAIL_DURATION_MS } from '../detailedCapture';

function fixture() {
  let time = 0; const rows: Record<string, unknown>[] = [];
  const write = jest.fn((payload: Record<string, unknown>) => { rows.push(payload); return true; });
  const capture = new DetailedCapture(write, 'android', () => 1000000 + time, () => time);
  return { capture, rows, write, tick: (n: number) => { time = n; } };
}
test('retains exact split-name finals and separate partial fields alongside observed ownerless output', () => {
  const { capture, rows } = fixture();
  capture.session('SES-test-1');
  capture.text({ seq: 0, final: false, confirmed: 'Zeynep', tentative: '.', text: 'Zeynep .' });
  capture.text({ seq: 1, final: true, text: 'Zeynep.', sourceStartSample: 0, sourceEndSample: 16000 });
  capture.text({ seq: 2, final: true, text: 'Sunum dosyasını hazırlayacak.', sourceStartSample: 16000, sourceEndSample: 64000 });
  capture.analysis({ version: 3, partial: true, summary: '', decisions: [], actions: [{ text: 'Sunum dosyasını hazırlayacak.', owner: null, dueDate: null }] }, true);
  expect(rows[2]).toMatchObject({ kind: 'gateway_text', confirmed: 'Zeynep', tentative: '.', final: false });
  expect(rows[3]).toMatchObject({ text: 'Zeynep.', sourceStartSample: 0, sourceEndSample: 16000 });
  expect(rows[5]).toMatchObject({ observedAfterFinalSeq: 2, actions: [{ owner: null }], microphoneOpen: true });
});
test('measures known PCM across callback boundaries without retaining PCM samples', () => {
  const { capture, rows } = fixture();
  capture.pcm(new Int16Array(800).fill(1000).buffer, 16000, 1, 0, true, {});
  capture.pcm(new Int16Array(800).fill(-1000).buffer, 16000, 1, 70, true, {});
  capture.pcm(new Int16Array(1600).buffer, 16000, 1, 200, false, {});
  capture.draining();
  const pcm = rows.find(e => e.kind === 'pcm');
  expect(pcm).toMatchObject({ callbackCount: 3, maxCallbackGapMs: 130, sendAccepted: 2, sendRejected: 1,
    windows: [{ firstSample: 0, samples: 1600, rms: 1000, peak: 1000, zeroSamples: 0, longestZeroRun: 0 },
      { firstSample: 1600, samples: 1600, rms: 0, peak: 0, zeroSamples: 1600, longestZeroRun: 1600 }] });
  capture.pcm(new Int16Array(1600).buffer, 16000, 1, 300, true, {});
  capture.stop();
  expect(rows.filter(e => e.kind === 'pcm')).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain('"data"');
});
test('enforces deadline at every callback, bounds event storms, and rejects closed-run callbacks', () => {
  const { capture, rows, tick } = fixture();
  tick(DETAIL_DURATION_MS);
  capture.text({ seq: 1, final: true, text: 'AFTER_DEADLINE' });
  capture.analysis({ version: 1, partial: false, summary: 'AFTER_DEADLINE', decisions: [], actions: [] }, false);
  expect(rows.at(-1)).toMatchObject({ kind: 'end', reason: 'duration' });
  expect(JSON.stringify(rows)).not.toContain('AFTER_DEADLINE');
  const storm = fixture();
  for (let i = 0; i < 2500; i++) storm.capture.text({ seq: i, final: false, text: 'bounded' });
  expect(storm.rows).toHaveLength(2001);
  expect(storm.rows.at(-1)).toMatchObject({ kind: 'end', reason: 'limit' });
  const closed = fixture(); closed.capture.stop(); closed.capture.text({ seq: 2, final: true, text: 'LATE' });
  expect(JSON.stringify(closed.rows)).not.toContain('LATE');
});

test('reports unmeasured PCM buffers without silently shifting later sample positions', () => {
  const { capture, rows } = fixture();
  capture.pcm(new Int16Array(800).buffer, 16000, 1, 0, true, {});
  capture.pcm(new Int16Array(20000).buffer, 16000, 1, 100, true, {});
  capture.pcm(new Int16Array(1600).buffer, 16000, 1, 200, true, {});
  capture.pcm(new ArrayBuffer(3), 16000, 1, 300, true, {});
  capture.pcm(new Int16Array(1600).buffer, 16000, 1, 400, true, {});
  capture.stop();
  expect(rows.filter(e => e.kind === 'pcm_gap')).toEqual([
    { kind: 'pcm_gap', reason: 'oversize', bytes: 40000, sampleRate: 16000, channels: 1, skippedSamples: 20000, sampleOriginKnown: true },
    { kind: 'pcm_gap', reason: 'unsupported_format', bytes: 3, sampleRate: 16000, channels: 1, sampleOriginKnown: false },
  ]);
  const measured = rows.filter(e => e.kind === 'pcm');
  expect(measured[1]).toMatchObject({ sampleOriginKnown: true, windows: [{ firstSample: 20800 }] });
  expect(measured[2]).toMatchObject({ sampleOriginKnown: false });
});
test('redacts arbitrary envelope fields and marks content truncation on write and reread', () => {
  const payload = cleanDetail({ kind: 'gateway_text', seq: 1, final: true, text: 'x'.repeat(5000), authorization: 'SECRET', sourceStartSample: -1, sourceEndSample: 10 });
  expect(payload).toMatchObject({ text: 'x'.repeat(4096), truncated: true });
  expect(payload).not.toHaveProperty('authorization'); expect(payload).not.toHaveProperty('sourceStartSample');
  const meeting = '00000000-0000-4000-8000-000000000001';
  const raw = JSON.stringify({ at: 1, expiresAt: 3600001, meeting, runId: meeting, payload: { ...payload, token: 'SECRET' } });
  expect(JSON.stringify(decodeDetail(raw, meeting))).not.toContain('SECRET');
  const hostile = cleanDetail({ kind: 'gateway_text', text: '\u0001'.repeat(4096), confirmed: '\u0001'.repeat(4096), tentative: '\u0001'.repeat(4096) });
  expect(JSON.stringify(hostile).length).toBeLessThan(50000);
  expect(hostile.truncated).toBe(true);
  expect(() => decodeDetail(raw, 'bad')).toThrow();
  const broken = new DetailedCapture(() => { throw new Error('disk'); }, 'ios');
  expect(() => broken.text({ seq: 1, text: 'never', final: true })).not.toThrow();
});
