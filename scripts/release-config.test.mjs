import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { EAS_VERSION, PROJECT_ID } from './release-common.mjs';
const require = createRequire(import.meta.url);
const ignore = require('ignore');
const YAML = require('yaml');
const appConfig = require('../app.config.js');
const base = JSON.parse(readFileSync('app.json', 'utf8')).expo;
const eas = JSON.parse(readFileSync('eas.json', 'utf8'));

function profile(name) {
  const own = eas.build[name];
  if (!own.extends) return own;
  const parent = profile(own.extends);
  return { ...parent, ...own, env: { ...parent.env, ...own.env }, ios: { ...parent.ios, ...own.ios } };
}
test('existing native builds retain OTA disabled; dedicated profiles require a new fingerprint-enabled build', () => {
  const oldOta = process.env.MOBILE_OTA_ENABLED, oldFcm = process.env.MOBILE_FCM_TEST;
  try {
    delete process.env.MOBILE_OTA_ENABLED; delete process.env.MOBILE_FCM_TEST;
    assert.equal(appConfig({ config: globalThis.structuredClone(base) }).updates.enabled, false);
    process.env.MOBILE_OTA_ENABLED = '1';
    const configured = appConfig({ config: globalThis.structuredClone(base) });
    assert.equal(configured.updates.enabled, true);
    assert.deepEqual(configured.runtimeVersion, { policy: 'fingerprint' });
    assert.equal(configured.updates.url, `https://u.expo.dev/${PROJECT_ID}`);
    assert.equal(base.updates.enabled, false);
  } finally {
    if (oldOta === undefined) delete process.env.MOBILE_OTA_ENABLED; else process.env.MOBILE_OTA_ENABLED = oldOta;
    if (oldFcm === undefined) delete process.env.MOBILE_FCM_TEST; else process.env.MOBILE_FCM_TEST = oldFcm;
  }
  assert.equal(eas.cli.version, EAS_VERSION);
  for (const channel of ['development', 'preview', 'production']) {
    const p = profile(`ota-${channel}`);
    assert.equal(p.channel, channel); assert.equal(p.environment, channel);
    assert.equal(p.env.MOBILE_OTA_ENABLED, '1'); assert.notEqual(p.ios?.simulator, true);
    assert.notEqual(p.developmentClient, true);
  }
});
test('EAS upload excludes server credentials, signing files and receipts without excluding application source', () => {
  const uploads = ignore().add(readFileSync('.easignore', 'utf8'));
  const git = ignore().add(readFileSync('.gitignore', 'utf8'));
  // Filename-only synthetic check: no credential file contents are accessed.
  for (const file of ['play-store-credentials.json', 'credentials.json', 'secrets/test-service-account.json',
    'secrets/firebase-service-account-backup.json', 'secrets/testserviceAccount.json',
    'secrets/signing.p8', 'secrets/signing.p12', 'secrets/signing.mobileprovision',
    'secrets/signing.keystore', 'secrets/signing.jks', 'secrets/signing.pem', 'secrets/signing.key',
    '.firebase/cache.json', 'release-evidence/update.json', 'release-intent.json']) {
    assert.ok(uploads.ignores(file), `EAS must exclude ${file}`);
    assert.ok(git.ignores(file), `Git must exclude ${file}`);
  }
  for (const file of ['app.config.js', 'app.json', 'eas.json', 'src/audio/liveTestApi.ts', 'modules/workcube-pcm-background/expo-module.config.json'])
    assert.equal(uploads.ignores(file), false, `EAS needs ${file}`);
  assert.ok(uploads.ignores('dist-native-push-android/bundle.js'));
});
test('release workflow has fixed CLI, main-only execution, environment, channel lock and evidence retention', () => {
  const workflow = YAML.parse(readFileSync('.github/workflows/mobile-update.yml', 'utf8'));
  assert.equal(workflow.jobs.update.if, "github.ref == 'refs/heads/main'");
  assert.equal(workflow.jobs.update.environment, 'mobile-${{ inputs.channel }}');
  assert.equal(workflow.concurrency.group, 'mobile-update-${{ inputs.channel }}');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.on.workflow_dispatch.inputs.execute.default, false);
  const commands = workflow.jobs.update.steps.filter(step => step.run).map(step => step.run).join('\n');
  assert.ok(commands.includes(`npm install --global eas-cli@${EAS_VERSION}`));
  assert.ok(commands.includes('eas env:exec "$UPDATE_CHANNEL"'));
  assert.ok(!commands.includes('${{ inputs.'));
  assert.ok(workflow.jobs.update.steps.some(step => step.if === 'always()' && step.with?.path === 'release-evidence/'));
  const unit = YAML.parse(readFileSync('.github/workflows/mobile-unit-checks.yml', 'utf8'));
  for (const path of ['app.json', 'eas.json', '.easignore', '.gitignore', 'scripts/**', '.github/workflows/mobile-*.yml'])
    assert.ok(unit.on.pull_request.paths.includes(path));
  assert.ok(unit.jobs.unit.steps.some(step => step.run?.includes('scripts/update-plan.test.mjs')));
});
