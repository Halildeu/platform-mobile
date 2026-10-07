import { nativePcmStopReason, PcmStartAttempt, supportsPcmLifecycle, type PcmLifecycleStream } from '../pcmLifecycle';

const native = (): PcmLifecycleStream => ({ workcubePcmLifecycleVersion: 1, workcubeCaptureId: 'old', configureBackgroundCapture: jest.fn() });
it('requires both reviewed capability and native method', () => {
  expect(supportsPcmLifecycle(native())).toBe(true);
  for (const stream of [undefined, {}, { workcubePcmLifecycleVersion: 1 }, { ...native(), workcubePcmLifecycleVersion: 2 }]) {
    expect(supportsPcmLifecycle(stream)).toBe(false);
  }
});
it('handles stop before start resolves but rejects old, missing and delayed capture ids', () => {
  const attempt = new PcmStartAttempt();
  const stream = native();
  const event = { isStreaming: false, captureId: 'new', reason: 'audio-interruption' };
  expect(attempt.acceptsStop(event, stream, false)).toBe(false);
  expect(attempt.acceptsBuffer({ captureId: 'old' }, stream)).toBe(false);
  attempt.request(stream);
  expect(attempt.acceptsStop({ ...event, captureId: 'old' }, stream, false)).toBe(false);
  Object.assign(stream, { workcubeCaptureId: 'new' });
  expect(attempt.acceptsStop(event, stream, false)).toBe(true);
  expect(attempt.acceptsBuffer({ captureId: 'new' }, stream)).toBe(true);
  expect(attempt.acceptsBuffer({ captureId: 'old' }, stream)).toBe(false);
  expect(attempt.acceptsBuffer({}, stream)).toBe(false);
  expect(attempt.acceptsStop({ ...event, captureId: 'old' }, stream, true)).toBe(false);
  expect(attempt.acceptsStop({ isStreaming: false }, stream, true)).toBe(false);
  expect(attempt.acceptsStop({ ...event, isStreaming: true }, stream, true)).toBe(false);
  attempt.clear();
  expect(attempt.acceptsBuffer({ captureId: 'new' }, stream)).toBe(false);
  expect(attempt.acceptsStop(event, stream, true)).toBe(false);
  attempt.request(stream);
  expect(attempt.acceptsStop(event, stream, false)).toBe(false);
});
it('preserves legacy Android stop detection only after microphone startup', () => {
  const attempt = new PcmStartAttempt();
  attempt.request({});
  expect(attempt.acceptsStop({ isStreaming: false }, {}, false)).toBe(false);
  expect(attempt.acceptsStop({ isStreaming: false }, {}, true)).toBe(true);
});
it('uses fixed Turkish causes and never exposes unknown native payloads', () => {
  expect(nativePcmStopReason({ isStreaming: false, reason: 'input-route-lost' })).toContain('kulaklık');
  expect(nativePcmStopReason({ isStreaming: false, reason: 'PRIVATE_PAYLOAD' })).not.toContain('PRIVATE');
  expect(typeof nativePcmStopReason({ isStreaming: false, reason: '__proto__' })).toBe('string');
});
