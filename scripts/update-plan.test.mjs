import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updatePlan, verifyPostUpdate } from './update-plan.mjs';
import { runUpdate, collectState } from './update-execute.mjs';
import { config, input, id, runtime, build, update, state } from './update-fixtures.mjs';

test('publishes only one platform at 5% against a finished matching native fingerprint', () => {
  const plan = updatePlan(input, config, state());
  assert.deepEqual(plan.args, ['update', '--channel', 'preview', '--environment', 'preview', '--platform', 'android',
    '--rollout-percentage', '5', '--message', `Mobile ${input.sha}`, '--non-interactive', '--json']);
});
for (const [name, mutate] of [
  ['disabled OTA', c => { c.updates.enabled = false; }],
  ['manual runtime', c => { c.runtimeVersion.policy = 'appVersion'; }],
  ['platform runtime override', c => { c.android.runtimeVersion = 'wrong'; }],
  ['wrong project', c => { c.extra.eas.projectId = id(99); }],
  ['wrong application', c => { c.ios.bundleIdentifier = 'another.app'; }],
  ['wrong update server', c => { c.updates.url = 'https://example.invalid'; }],
  ['unsupported OTA signing configuration', c => { c.updates.codeSigningCertificate = 'certificate.pem'; }],
]) test(`rejects ${name}`, () => {
  const changed = globalThis.structuredClone(config); mutate(changed);
  assert.throws(() => updatePlan(input, changed, state()));
});
for (const [name, mutate] of [
  ['pending build', b => { b.status = 'IN_PROGRESS'; }], ['failed build', b => { b.error = { message: 'failed' }; }],
  ['other build', b => { b.id = id(9); }], ['other project', b => { b.app.id = id(9); }],
  ['other app', b => { b.appIdentifier = 'other'; }], ['other platform', b => { b.platform = 'IOS'; }],
  ['simulator', b => { b.isForIosSimulator = true; }], ['non OTA profile', b => { b.buildProfile = 'preview'; }],
  ['wrong channel', b => { b.updateChannel.name = 'production'; }], ['wrong distribution', b => { b.distribution = 'STORE'; }],
  ['fingerprint mismatch', b => { b.fingerprint.hash = 'e'.repeat(40); }], ['no runtime', b => { b.runtime = null; }],
  ['no archive', b => { b.artifacts = {}; }], ['no source', b => { b.gitCommitHash = null; }],
]) test(`rejects native ${name}`, () => {
  const s = state(); mutate(s.build); assert.throws(() => updatePlan(input, config, s));
});
test('native changes reject publication but do not strand recovery of an installed old runtime', () => {
  const s = state([update(10)]); s.localRuntime = 'f'.repeat(40);
  assert.throws(() => updatePlan(input, config, s), /new tested build/);
  const plan = updatePlan({ ...input, operation: 'rollback-embedded', group: id(10) }, config, s);
  assert.ok(plan.args.includes(runtime));
});
test('channel must resolve under the selected project to a single canonical branch', () => {
  for (const mutate of [
    app => { app.id = id(99); }, app => { app.updateChannelByName.name = 'production'; },
    app => { app.updateChannelByName.isPaused = true; }, app => { delete app.updateChannelByName.isPaused; },
    app => { app.updateBranchByName.name = 'other'; }, app => { app.updateChannelByName.branchMapping = '{'; },
    app => { app.updateChannelByName.branchMapping = JSON.stringify({ version: 1, data: [] }); },
    app => { app.updateChannelByName.branchMapping = JSON.stringify({ version: 0, data: [{ branchId: id(9), branchMappingLogic: 'true' }] }); },
    app => { app.updateChannelByName.branchMapping = JSON.stringify({ version: 0, data: [{ branchId: id(2), branchMappingLogic: 'false' }] }); },
  ]) { const s = state(); mutate(s.snapshot.app.byId); assert.throws(() => updatePlan(input, config, s)); }
});
test('invalid/truncated/misordered update metadata cannot yield a plan', () => {
  for (const overrides of [
    { platform: 'ios' }, { branch: { id: id(9), name: 'preview' } }, { runtime: { version: 'x' } },
    { rolloutPercentage: undefined }, { rolloutPercentage: 101 }, { rolloutControlUpdate: undefined },
    { rolloutControlUpdate: { id: id(110), group: id(10) } }, { isRollBackToEmbedded: undefined },
    { isGitWorkingTreeDirty: true }, { manifestFragment: '{' }, { gitCommitHash: null },
  ]) assert.throws(() => updatePlan(input, config, state([update(10, overrides)])));
  assert.throws(() => updatePlan(input, config, state([update(10), update(11)])));
  assert.throws(() => updatePlan(input, config, state([update(10), update(10)])));
  assert.throws(() => updatePlan(input, config, state([update(12), update(11), update(10)])));
});
test('5 -> 25 -> 100 cannot be skipped, reversed or applied to another channel group', () => {
  for (const [operation, from, to] of [['advance-25', 5, 25], ['advance-100', 25, 100]]) {
    const params = { ...input, operation, group: id(10) };
    assert.ok(updatePlan(params, config, state([update(10, { rolloutPercentage: from })])).args.includes(String(to)));
    assert.throws(() => updatePlan(params, config, state([update(10, { rolloutPercentage: to })])));
    assert.throws(() => updatePlan({ ...params, group: id(99) }, config, state([update(10, { rolloutPercentage: from })])));
  }
  assert.throws(() => updatePlan(input, config, state([update(10, { rolloutPercentage: 5 })])), /active rollout/);
});
test('group commands reject a hidden opposite-platform member in current AND control groups', () => {
  const control = update(9), current = update(10, { rolloutPercentage: 5, rolloutControlUpdate: { id: control.id, group: control.group } });
  const params = { ...input, operation: 'revert-current', group: current.group };
  for (const group of [current.group, control.group]) {
    const s = state([current, control]); s.groups[group].push({ ...s.groups[group][0], platform: 'ios' });
    assert.throws(() => updatePlan(params, config, s), /mixed-platform/);
  }
  const s = state([current, control]); s.groups[control.group][0] = { ...control, branch: { id: id(77), name: 'preview' } };
  assert.throws(() => updatePlan(params, config, s), /mismatch/);
});
test('first active rollout reverts to embedded without requiring a previous group', () => {
  const current = update(10, { rolloutPercentage: 5 });
  const params = { ...input, operation: 'revert-current', group: current.group };
  const plan = updatePlan(params, config, state([current]));
  assert.equal(plan.recovery, null);
  assert.equal(plan.args[0], 'update:revert-update-rollout');
  const embedded = update(11, { isRollBackToEmbedded: true, manifestFragment: '', gitCommitHash: null });
  assert.equal(verifyPostUpdate(params, plan, state([embedded])).embedded, true);
  assert.equal(updatePlan(input, config, state([embedded])).args[0], 'update');
});
test('signed control or incomplete signing is rejected before the destructive part of CLI revert', () => {
  for (const extra of [{ awaitingCodeSigningInfo: true }, { codeSigningInfo: { keyid: 'test', sig: 'test', alg: 'test' } }, { codeSigningInfo: undefined }]) {
    const control = update(9, extra), current = update(10, { rolloutPercentage: 5, rolloutControlUpdate: { id: control.id, group: control.group } });
    assert.throws(() => updatePlan({ ...input, operation: 'revert-current', group: current.group }, config, state([current, control])), /signing/);
  }
});
test('revert reads actual control rather than guessing the adjacent older row', () => {
  const control = update(8), previous = update(9), current = update(10, { rolloutPercentage: 25, rolloutControlUpdate: { id: control.id, group: control.group } });
  const params = { ...input, operation: 'revert-current', group: current.group };
  const s = state([current, previous]); s.groups[control.group] = [control];
  const plan = updatePlan(params, config, s);
  assert.equal(plan.recovery.group, control.group);
  const restored = update(11, { manifestFragment: control.manifestFragment, gitCommitHash: control.gitCommitHash });
  assert.equal(verifyPostUpdate(params, plan, state([restored, previous])).manifestHash, plan.recovery.manifestHash);
  assert.throws(() => verifyPostUpdate(params, plan, state([update(11)])), /content/);
});
test('completed first rollout can roll back to embedded; previous requires a verified compatible predecessor', () => {
  const current = update(10), previous = update(9);
  const params = { ...input, group: current.group };
  assert.equal(updatePlan({ ...params, operation: 'rollback-embedded' }, config, state([current])).args[0], 'update:roll-back-to-embedded');
  assert.throws(() => updatePlan({ ...params, operation: 'rollback-previous', previousGroup: id(8) }, config, state([current, previous])));
  assert.throws(() => updatePlan({ ...params, operation: 'rollback-previous', previousGroup: previous.group }, config, state([current])));
  const plan = updatePlan({ ...params, operation: 'rollback-previous', previousGroup: previous.group }, config, state([current, previous]));
  assert.equal(plan.recovery.group, previous.group);
  assert.ok(plan.args.includes('--destination-channel'));
});
test('post-publication requires exact source, new group, rollout, channel and control', () => {
  const current = update(10), plan = updatePlan(input, config, state([current]));
  const published = update(11, { rolloutPercentage: 5, gitCommitHash: input.sha, rolloutControlUpdate: { id: current.id, group: current.group } });
  assert.equal(verifyPostUpdate(input, plan, state([published, current])).sha, input.sha);
  for (const changed of [{ gitCommitHash: 'f'.repeat(40) }, { rolloutPercentage: 100 }, { rolloutControlUpdate: null }, { isRollBackToEmbedded: true }])
    assert.throws(() => verifyPostUpdate(input, plan, state([{ ...published, ...changed }, current])));
  const s = state([published]); s.snapshot.app.byId.updateChannelByName.id = id(33);
  assert.throws(() => verifyPostUpdate(input, plan, s));
});
test('advancement postcheck detects unchanged percentage or altered content', () => {
  const current = update(10, { rolloutPercentage: 5 });
  const params = { ...input, group: current.group, operation: 'advance-25' };
  const plan = updatePlan(params, config, state([current]));
  assert.throws(() => verifyPostUpdate(params, plan, state([current])));
  assert.equal(verifyPostUpdate(params, plan, state([{ ...current, rolloutPercentage: 25 }])).percentage, 25);
  assert.throws(() => verifyPostUpdate(params, plan, state([{ ...current, rolloutPercentage: 25, manifestFragment: '{}' }])));
});
test('collector reads full control group and respects the native runtime, not current local runtime', async () => {
  const control = update(8), current = update(10, { rolloutPercentage: 5, rolloutControlUpdate: { id: control.id, group: control.group } });
  const seen = [], params = { ...input, group: current.group, operation: 'revert-current' };
  const s = state([current]);
  const result = await collectState(params, build, 'f'.repeat(40), {
    readSnapshot: async (scope, value) => { assert.equal(value, runtime); return s.snapshot; },
    readGroup: async group => { seen.push(group); return [group === current.group ? current : control]; },
  });
  assert.deepEqual(seen, [current.group, control.group]);
  assert.equal(updatePlan(params, config, result).recovery.group, control.group);
});
test('dry run and changed preflight send zero mutations', async () => {
  let mutations = 0, reads = 0;
  const records = [], deps = { read: async () => reads++ === 0 ? state() : state([update(10)]),
    record: async receipt => records.push(receipt), mutate: async () => { mutations++; } };
  assert.equal((await runUpdate(input, config, deps)).phase, 'prepared');
  assert.equal(mutations, 0);
  reads = 0;
  await assert.rejects(runUpdate(input, config, deps, true), /changed before execution/);
  assert.equal(mutations, 0);
});
test('mutation error and postcheck error leave uncertainty and never retry', async () => {
  for (const failMutation of [true, false]) {
    let mutations = 0;
    const receipts = [];
    await assert.rejects(runUpdate(input, config, { read: async () => state(),
      record: async receipt => receipts.push(receipt),
      mutate: async () => { mutations++; if (failMutation) throw new Error('private provider detail'); },
    }, true), /uncertain/);
    assert.equal(mutations, 1);
    assert.equal(receipts.at(-1).phase, 'mutation-outcome-unknown');
    assert.ok(!JSON.stringify(receipts).includes('private provider detail'));
    assert.ok(!JSON.stringify(receipts).includes('native.apk'));
  }
});
test('successful execution stores only sanitized immutable outcome evidence', async () => {
  let reads = 0, mutations = 0;
  const published = update(11, { gitCommitHash: input.sha, rolloutPercentage: 5 });
  const receipt = await runUpdate(input, config, { read: async () => ++reads < 3 ? state() : state([published]),
    record: async () => {}, mutate: async () => { mutations++; } }, true);
  assert.equal(mutations, 1); assert.equal(receipt.phase, 'verified');
  assert.equal(receipt.result.group, published.group);
  assert.ok(!JSON.stringify(receipt).includes('launchAsset'));
});
