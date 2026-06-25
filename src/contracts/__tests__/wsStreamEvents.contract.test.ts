import debugFixture from '../../../contracts/fixtures/ws-stream-events/valid/debug.json';
import errorFixture from '../../../contracts/fixtures/ws-stream-events/valid/error.json';
import finalFixture from '../../../contracts/fixtures/ws-stream-events/valid/final.json';
import loadingFixture from '../../../contracts/fixtures/ws-stream-events/valid/loading.json';
import partialFixture from '../../../contracts/fixtures/ws-stream-events/valid/partial.json';
import readyFixture from '../../../contracts/fixtures/ws-stream-events/valid/ready.json';
import finalExtraAudioPathFixture from '../../../contracts/fixtures/ws-stream-events/invalid/final-extra-audio-path.json';
import partialExtraSpeakerFixture from '../../../contracts/fixtures/ws-stream-events/invalid/partial-extra-speaker.json';
import readyLowSampleRateFixture from '../../../contracts/fixtures/ws-stream-events/invalid/ready-low-sample-rate.json';
import unknownTypeFixture from '../../../contracts/fixtures/ws-stream-events/invalid/unknown-type.json';
import {
  parseWsStreamEvent,
  validateWsStreamEvent,
  WS_STREAM_EVENT_TYPES,
} from '../wsStreamEvents';

const validFixtures: { name: string; payload: unknown }[] = [
  { name: 'loading', payload: loadingFixture },
  { name: 'ready', payload: readyFixture },
  { name: 'partial', payload: partialFixture },
  { name: 'final', payload: finalFixture },
  { name: 'error', payload: errorFixture },
  { name: 'debug', payload: debugFixture },
];

const invalidFixtures: { name: string; payload: unknown }[] = [
  { name: 'unknown-type', payload: unknownTypeFixture },
  { name: 'ready-low-sample-rate', payload: readyLowSampleRateFixture },
  { name: 'partial-extra-speaker', payload: partialExtraSpeakerFixture },
  { name: 'final-extra-audio-path', payload: finalExtraAudioPathFixture },
];

describe('ws-stream event consumer contract', () => {
  it.each(validFixtures)('accepts %s fixture', ({ payload }) => {
    const result = validateWsStreamEvent(payload);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(WS_STREAM_EVENT_TYPES).toContain(result.event.type);
      expect(parseWsStreamEvent(payload)).toEqual(payload);
    }
  });

  it.each(invalidFixtures)('rejects %s fixture', ({ payload }) => {
    const result = validateWsStreamEvent(payload);

    expect(result.ok).toBe(false);
  });

  it('covers every canonical event type with at least one fixture', () => {
    const fixtureTypes = validFixtures
      .map(({ payload }) => parseWsStreamEvent(payload).type)
      .sort();

    expect(fixtureTypes).toEqual([...WS_STREAM_EVENT_TYPES].sort());
  });

  it('keeps fixtures synthetic and redacted', () => {
    const fixtureBody = JSON.stringify([
      ...validFixtures.map(({ payload }) => payload),
      ...invalidFixtures.map(({ payload }) => payload),
    ]);

    expect(fixtureBody).not.toMatch(
      /halil|zeynep|@|bearer|token|jwt|data:audio|base64|meeting_id/i,
    );
  });
});
