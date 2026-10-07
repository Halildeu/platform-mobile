import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { APP_ID, PROJECT_ID } from './release-common.mjs';
import { buildArgs, buildIdFromOutput, inspectBuild, inspectSubmission, packageConfig, submissionIdFromOutput, submitArgs, submitProfile, validatePackageInput } from './package-plan.mjs';
import { runPackage, withSubmitConfig } from './package-execute.mjs';

const buildId = '10000000-0000-4000-8000-000000000001';
const submissionId = '20000000-0000-4000-8000-000000000001';
const input = { operation: 'submit', platform: 'android', channel: 'production', ota: false,
  sha: 'a'.repeat(40), buildId, digest: 'b'.repeat(64), ascAppId: '123456789' };
const build = () => ({ id: buildId, app: { id: PROJECT_ID }, appIdentifier: APP_ID,
  status: 'FINISHED', platform: 'ANDROID', gitCommitHash: input.sha, buildProfile: 'production',
  updateChannel: { name: 'production' }, distribution: 'STORE', isForIosSimulator: false,
  artifacts: { applicationArchiveUrl: 'https://expo.dev/artifacts/eas/example.aab?secret=withheld' },
  appVersion: '1.0.0', appBuildVersion: '10', submissions: [] });
const submission = () => ({ id: submissionId, app: { id: PROJECT_ID }, platform: 'ANDROID',
  status: 'FINISHED', submittedBuild: { id: buildId }, androidConfig: { track: 'internal', releaseStatus: 'COMPLETED', rollout: null } });
const config = () => ({ appConfig: { extra: { eas: { projectId: PROJECT_ID } },
  android: { package: APP_ID }, ios: { bundleIdentifier: APP_ID }, updates: { enabled: false } },
  buildProfile: { channel: 'production', environment: 'production', distribution: 'store', credentialsSource: 'remote', buildType: 'app-bundle', env: { MOBILE_OTA_ENABLED: '0' } } });
const eas = JSON.parse(readFileSync('eas.json', 'utf8'));

test('numeric ASC configuration is scoped to CLI lifetime and restored exactly, including failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mobile-submit-config-'));
  const path = join(directory, 'eas.json');
  const original = JSON.stringify(eas, null, 3) + '\r\n';
  try {
    for (const fail of [false, true]) {
      writeFileSync(path, original);
      const run = withSubmitConfig({ ...input, platform: 'ios' }, path, async () => {
        assert.equal(JSON.parse(readFileSync(path, 'utf8')).submit.internal.ios.ascAppId, input.ascAppId);
        if (fail) throw new Error('CLI timeout');
        return 'sent';
      });
      if (fail) await assert.rejects(run, /CLI timeout/); else assert.equal(await run, 'sent');
      assert.equal(readFileSync(path, 'utf8'), original);
    }
    await assert.rejects(withSubmitConfig({ ...input, platform: 'ios' }, path, async () => writeFileSync(path, 'concurrent change')), /refusing to overwrite/);
    assert.equal(readFileSync(path, 'utf8'), 'concurrent change');
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  }
});
function fixture(overrides = {}) {
  const records = [], calls = [];
  const deps = { config: async () => config(), submitConfig: async () => submitProfile(input, eas),
    build: async id => { calls.push(['read-build', id]); return build(); },
    submission: async id => { calls.push(['read-submission', id]); return submission(); },
    archive: async () => ({ sha256: input.digest, bytes: 123 }),
    record: async receipt => records.push(globalThis.structuredClone(receipt)),
    mutate: async args => { calls.push(['mutate', args]); return `Submission details: https://expo.dev/accounts/company/projects/meeting/submissions/${submissionId}\n`; },
    wait: async (read, inspect) => { const value = await read(); inspect(value, true); return value; }, ...overrides };
  return { deps, records, calls };
}

test('finished archive proof rejects foreign source, platform, channel, simulator and missing fields', () => {
  assert.equal(inspectBuild(build(), input).buildId, buildId);
  for (const change of [{ id: submissionId }, { app: { id: submissionId } }, { appIdentifier: 'com.other' },
    { gitCommitHash: 'c'.repeat(40) }, { platform: 'IOS' }, { buildProfile: 'preview' },
    { distribution: 'INTERNAL' }, { updateChannel: { name: 'preview' } }, { isForIosSimulator: true },
    { isForIosSimulator: undefined }, { status: 'IN_QUEUE' }, { error: { errorCode: 'error' } }, { artifacts: {} }]) {
    assert.throws(() => inspectBuild({ ...build(), ...change }, input));
  }
  assert.ok(!JSON.stringify(inspectBuild(build(), input)).includes('secret'));
});
test('profile proof preserves normal/OTA and simulator distinctions on both platforms', () => {
  for (const platform of ['android', 'ios']) for (const channel of ['development', 'preview', 'production']) for (const ota of [false, true]) {
    const request = { ...input, operation: 'build', buildId: '', platform, channel, ota };
    const p = validatePackageInput(request);
    const c = config(); c.buildProfile = { ...c.buildProfile, channel, environment: channel,
      distribution: p.distribution.toLowerCase(), simulator: p.simulator, env: { MOBILE_OTA_ENABLED: ota ? '1' : '0' } };
    if (ota) { c.appConfig.runtimeVersion = { policy: 'fingerprint' }; c.appConfig.updates = { enabled: true, url: `https://u.expo.dev/${PROJECT_ID}` }; }
    assert.equal(packageConfig(request, c).profile, `${ota ? 'ota-' : ''}${channel}`);
    c.buildProfile.credentialsSource = 'local'; assert.throws(() => packageConfig(request, c));
  }
});
test('submit profiles are exact internal destinations and require real ASC app ID', () => {
  submitProfile(input, eas); submitProfile({ ...input, platform: 'ios' }, eas);
  assert.throws(() => submitProfile({ ...input, platform: 'ios', ascAppId: 'ASC_APP_ID' }, eas));
  for (const change of [{ track: 'production' }, { releaseStatus: 'draft' }, { serviceAccountKeyPath: 'local.json' }]) {
    const modified = globalThis.structuredClone(eas); Object.assign(modified.submit.internal.android, change);
    assert.throws(() => submitProfile(input, modified));
  }
});
test('commands use an explicit identity, no-wait and frozen credentials; never latest or auto-submit', () => {
  assert.deepEqual(submitArgs(input), ['submit', '--platform', 'android', '--profile', 'internal', '--id', buildId, '--non-interactive', '--no-wait', '--no-auto-testflight-setup']);
  const args = buildArgs({ ...input, operation: 'build', buildId: '' });
  assert.ok(args.includes('--freeze-credentials') && args.includes('--no-wait') && args.includes('--json'));
  assert.ok(!args.includes('--auto-submit'));
  assert.throws(() => buildArgs({ ...input, operation: 'build' }));
  assert.throws(() => submitArgs({ ...input, submissionId }));
});
test('pinned CLI outputs must identify exactly one operation, never a UUID in an unrelated message', () => {
  assert.equal(buildIdFromOutput(JSON.stringify([{ id: buildId }])), buildId);
  assert.throws(() => buildIdFromOutput(JSON.stringify([{ id: buildId }, { id: submissionId }])));
  assert.throws(() => buildIdFromOutput('unknown'));
  const line = `Submission details: https://expo.dev/accounts/team/projects/app/submissions/${submissionId}`;
  assert.equal(submissionIdFromOutput(`${line}\n`), submissionId);
  for (const invalid of [submissionId, `${line}\n${line}`, line.replace('expo.dev', 'attacker.test'), line.replace('Submission details:', 'Other:')]) assert.throws(() => submissionIdFromOutput(invalid));
});
test('dry run downloads/verifies the selected archive but sends nothing', async () => {
  const f = fixture(); const receipt = await runPackage(input, f.deps);
  assert.equal(receipt.phase, 'prepared'); assert.equal(receipt.archive.sha256, input.digest);
  assert.equal(f.calls.filter(c => c[0] === 'mutate').length, 0);
});
test('submit persists uncertainty, then exact identity before polling, and verifies destination', async () => {
  const f = fixture();
  f.deps.mutate = async args => { assert.equal(f.records.at(-1).phase, 'creation-outcome-unknown'); f.calls.push(['mutate', args]); return `Submission details: https://expo.dev/accounts/team/projects/app/submissions/${submissionId}`; };
  f.deps.submission = async id => { assert.equal(f.records.at(-1).submissionId, id); return submission(); };
  const receipt = await runPackage(input, f.deps, true);
  assert.equal(receipt.phase, 'submission-verified'); assert.equal(f.calls.filter(c => c[0] === 'mutate').length, 1);
  assert.ok(!JSON.stringify(f.records).includes('secret='));
});
test('changed archive, existing submission and changed remote state each prevent sending', async () => {
  for (const overrides of [
    { archive: async () => ({ sha256: 'c'.repeat(64), bytes: 123 }) },
    { build: async () => ({ ...build(), submissions: [{ id: submissionId, status: 'FINISHED' }] }) },
  ]) { const f = fixture(overrides); await assert.rejects(runPackage(input, f.deps, true)); assert.equal(f.calls.filter(c => c[0] === 'mutate').length, 0); }
  let count = 0;
  const f = fixture({ build: async () => ({ ...build(), gitCommitHash: ++count === 1 ? input.sha : 'c'.repeat(40) }) });
  await assert.rejects(runPackage(input, f.deps, true)); assert.equal(f.calls.filter(c => c[0] === 'mutate').length, 0);
});
test('timeout/ambiguous output is not retried or mislabeled successful', async () => {
  for (const output of [null, 'provider did not return identity']) {
    const f = fixture(); let sends = 0;
    f.deps.mutate = async () => { sends++; if (output === null) throw new Error('timeout secret'); return output; };
    await assert.rejects(runPackage(input, f.deps, true)); assert.equal(sends, 1);
    assert.equal(f.records.at(-1).phase, 'creation-outcome-unknown');
  }
});
test('a different archive on the last metadata read is hashed again and cannot be submitted', async () => {
  let reads = 0, downloads = 0;
  const f = fixture({
    build: async () => ({ ...build(), artifacts: { applicationArchiveUrl: ++reads === 1 ? 'original' : 'changed' } }),
    archive: async value => { downloads++; return { sha256: value.artifacts.applicationArchiveUrl === 'original' ? input.digest : 'c'.repeat(64), bytes: 123 }; },
  });
  await assert.rejects(runPackage(input, f.deps, true), /Archive changed/);
  assert.equal(downloads, 2); assert.equal(f.calls.filter(c => c[0] === 'mutate').length, 0);
});
test('receipt disk failure prevents the first mutation', async () => {
  const f = fixture({ record: async () => { throw new Error('disk full'); } });
  await assert.rejects(runPackage(input, f.deps, true)); assert.equal(f.calls.length, 0);
});
test('build start stores returned UUID before the first read; resume never creates', async () => {
  const request = { ...input, operation: 'build', buildId: '' };
  const f = fixture({ mutate: async () => JSON.stringify([{ id: buildId }]) });
  f.deps.build = async id => { assert.equal(f.records.at(-1).buildId, id); return build(); };
  assert.equal((await runPackage(request, f.deps, true)).phase, 'build-verified');
  for (const execute of [false, true]) {
    const resumed = fixture({ mutate: async () => { throw new Error('must not dispatch'); }, config: async () => { throw new Error('must not start'); } });
    assert.equal((await runPackage({ ...request, buildId }, resumed.deps, execute)).phase, 'build-verified');
    const submitted = fixture({ mutate: async () => { throw new Error('must not send'); } });
    assert.equal((await runPackage({ ...input, submissionId }, submitted.deps, execute)).phase, 'submission-verified');
  }
});
test('submission proof rejects the wrong build/destination and failure while distinguishing store completion', () => {
  for (const change of [{ submittedBuild: { id: submissionId } }, { platform: 'IOS' }, { app: { id: buildId } },
    { status: 'ERRORED' }, { androidConfig: { track: 'production', releaseStatus: 'COMPLETED' } },
    { androidConfig: { track: 'internal', releaseStatus: 'DRAFT' } }]) assert.throws(() => inspectSubmission({ ...submission(), ...change }, { ...input, submissionId }));
  const ios = { ...submission(), platform: 'IOS', androidConfig: null, iosConfig: { ascAppIdentifier: input.ascAppId } };
  assert.equal(inspectSubmission(ios, { ...input, platform: 'ios', submissionId }).destination, 'app-store-connect');
  assert.throws(() => inspectSubmission(ios, { ...input, platform: 'ios', submissionId, ascAppId: '987654321' }));
});
