import { readSpeakerAttribution, SpeakerNumbering } from '../speakerAttribution';
const scope = '12345678-1234-3234-8234-123456789012';
const text = 'Merhaba 📝 dünya';
const turn = { speaker: 'S1', textStart: 0, textEnd: text.length, startMs: 0, endMs: 1000 };
const attribution = { scope, turns: [turn] };
const read = (value: unknown, start: unknown = 0, end: unknown = 16000) => readSpeakerAttribution(value, text, start, end);

test('matches bounded anonymous gateway contract and preserves UTF-16 offsets', () => {
  const result = read(attribution)!;
  expect(result).toEqual(attribution);
  expect(result.turns[0]).not.toBe(turn);
  expect(read({ scope, turns: [{ ...turn, textEnd: 10 }, { ...turn, speaker: 'UU', textStart: 11 }] })).toBeDefined();
});
test.each([undefined, null, {}, { ...attribution, scope: 'a name' },
  { ...attribution, extra: 1 }, { scope, turns: [] }, { scope, turns: Array(513).fill(turn) },
  { scope, turns: [{ ...turn, speaker: 'Zeynep' }] }, { scope, turns: [{ ...turn, speaker: 'S0' }] },
  { scope, turns: [{ ...turn, textStart: -1 }] }, { scope, turns: [{ ...turn, textEnd: text.length + 1 }] },
  { scope, turns: [{ ...turn, textStart: 0.5 }] }, { scope, turns: [{ ...turn, endMs: 1001 }] },
  { scope, turns: [{ ...turn, startMs: -1 }] }, { scope, turns: [{ ...turn, endMs: -1 }] },
  { scope, turns: [{ ...turn, extra: true }] }, { scope, turns: [{ ...turn, textStart: 1 }] },
  { scope, turns: [{ ...turn, textEnd: text.length - 1 }] },
  { scope, turns: [{ ...turn, textEnd: 9 }, { ...turn, textStart: 9 }] },
  { scope, turns: [{ ...turn, textEnd: 10 }, { ...turn, textStart: 9 }] },
])('ignores invalid optional metadata without exposing arbitrary speaker names: %#', value => {
  expect(read(value)).toBeUndefined();
});
test.each([[undefined, 16000], [0, undefined], [-1, 16000], [2, 1], [0, 0], [0.5, 16000], [0, Infinity], [0, Number.MAX_SAFE_INTEGER + 1]])(
  'requires a safe source window: %s..%s', (start, end) => expect(readSpeakerAttribution(attribution, text, start, end)).toBeUndefined(),
);
test('does not merge scoped identities and keeps assigned numbers stable', () => {
  const numbers = new SpeakerNumbering();
  expect(numbers.number(scope, 'UU')).toBeUndefined();
  expect(numbers.number(scope, 'S1')).toBe(1);
  expect(numbers.number(scope, 'S2')).toBe(2);
  expect(numbers.number('22345678-1234-3234-8234-123456789012', 'S1')).toBe(3);
  expect(numbers.number(scope, 'S1')).toBe(1);
});
