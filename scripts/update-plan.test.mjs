import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updatePlan } from './update-plan.mjs';
const config = { extra: { eas: { projectId: '3597d06c-21ec-4908-b453-e72f219d5758' } },
  runtimeVersion: { policy: 'appVersion' }, updates: { enabled: true, url: 'https://u.expo.dev/3597d06c-21ec-4908-b453-e72f219d5758' } };
const input = { operation: 'publish-5', channel: 'preview', sha: 'a'.repeat(40) };
test('refuses disabled OTA and wrong destinations before any command', () => {
  assert.throws(() => updatePlan(input, { ...config, updates: { enabled: false } }));
  assert.throws(() => updatePlan({ ...input, channel: 'preview;anything' }, config));
  assert.throws(() => updatePlan(input, { ...config, extra: {} }));
});
test('only starts at 5 and accepts explicit 25/100 advances', () => {
  assert.ok(updatePlan(input, config).includes('5'));
  const group = '12345678-1234-1234-1234-123456789012';
  for (const percentage of ['25', '100']) assert.ok(updatePlan({ ...input, group, operation: `advance-${percentage}` }, config).includes(percentage));
  assert.throws(() => updatePlan({ ...input, group, operation: 'advance-50' }, config));
});
test('rollback requires an explicit previous group instead of guessing latest', () => {
  assert.throws(() => updatePlan({ ...input, operation: 'rollback-previous' }, config));
  assert.equal(updatePlan({ ...input, operation: 'rollback-previous', group: '12345678-1234-1234-1234-123456789012' }, config)[0], 'update:republish');
});
