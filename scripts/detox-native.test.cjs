const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const plugin = require('../plugins/withDetoxE2E.cjs');
const config = require('../app.config.js');
const { fingerprint, verifyResults } = require('./detox-artifacts.cjs');
const Reporter = require('./detox-junit.cjs');
const sha = 'a'.repeat(40);
function isolated(fn) {
  const cwd = process.cwd(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detox-evidence-'));
  process.chdir(dir);
  try { fn(dir); } finally { process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true }); }
}
test('disabled plugin and config cannot add native test changes', () => {
  const previous = process.env.MOBILE_DETOX_E2E;
  try {
    for (const value of [undefined, '0', 'true', ' 1']) {
      if (value === undefined) delete process.env.MOBILE_DETOX_E2E; else process.env.MOBILE_DETOX_E2E = value;
      const source = { android: { package: 'com.workcube.meeting' }, plugins: [] };
      assert.equal(plugin(source), source);
      assert.deepEqual(config({ config: source }), source);
    }
  } finally { if (previous === undefined) delete process.env.MOBILE_DETOX_E2E; else process.env.MOBILE_DETOX_E2E = previous; }
});
test('test mode is explicit and rejects authenticated notification/update builds', () => {
  const env = { ...process.env };
  try {
    process.env.MOBILE_DETOX_E2E = '1';
    const source = { android: { package: 'com.workcube.meeting' }, plugins: [] };
    assert.deepEqual(config({ config: source }).plugins, ['./plugins/withDetoxE2E.cjs']);
    for (const name of ['MOBILE_FCM_TEST', 'MOBILE_OTA_ENABLED']) {
      process.env[name] = '1'; assert.throws(() => plugin(source)); assert.throws(() => config({ config: source })); delete process.env[name];
    }
  } finally { for (const name of ['MOBILE_DETOX_E2E', 'MOBILE_FCM_TEST', 'MOBILE_OTA_ENABLED']) {
    if (env[name] === undefined) delete process.env[name]; else process.env[name] = env[name];
  } }
});
test('native Gradle patches are repeatable, preserve source and pin matching instrumentation', () => {
  const original = 'android { namespace "com.workcube.meeting" }\n';
  const version = require('detox/package.json').version;
  const changed = plugin.appGradle(original, version);
  assert.ok(changed.startsWith(original)); assert.equal(plugin.appGradle(changed, version), changed);
  assert.ok(changed.includes(`com.wix:detox:${version}`)); assert.match(changed, /testBuildType 'release'/);
  assert.match(changed, /testInstrumentationRunner 'androidx.test.runner.AndroidJUnitRunner'/);
  assert.throws(() => plugin.appGradle(changed + '// unknown', version)); assert.throws(() => plugin.appGradle(original, '+'));
  const project = plugin.projectGradle('allprojects {}\n'); assert.equal(plugin.projectGradle(project), project);
  assert.ok(project.includes('$rootDir/../node_modules/detox/Detox-android'));
  assert.match(plugin.javaTest('com.workcube.meeting'), /Detox.runTests\(activity\)/);
  assert.throws(() => plugin.javaTest('com.unrelated.app'));
});
test('network exceptions have no wildcard, subdomain or global cleartext permission', () => {
  assert.match(plugin.network, /base-config cleartextTrafficPermitted="false"/);
  assert.deepEqual([...plugin.network.matchAll(/<domain includeSubdomains="false">([^<]+)<\/domain>/g)].map(match => match[1]), ['localhost', '127.0.0.1', '10.0.2.2']);
  assert.doesNotMatch(plugin.network, /includeSubdomains="true"/);
});
test('fingerprints require both APKs and detect a changed test APK', () => isolated(() => {
  const dir = 'android/app/build/outputs/apk'; fs.mkdirSync(dir + '/release', { recursive: true });
  fs.writeFileSync(dir + '/release/app-release.apk', 'app'); assert.throws(() => fingerprint('android', sha));
  fs.mkdirSync(dir + '/androidTest/release', { recursive: true }); fs.writeFileSync(dir + '/androidTest/release/app-release-androidTest.apk', 'instrumentation');
  const before = fingerprint('android', sha); assert.equal(before.files.length, 2);
  fs.writeFileSync(dir + '/androidTest/release/app-release-androidTest.apk', 'wrong instrumentation');
  assert.notDeepEqual(fingerprint('android', sha), before); assert.throws(() => fingerprint('android', 'main'));
}));
test('report uses concrete native results and rejects skipped, failed, interrupted or missing evidence', () => isolated(() => {
  const result = { success: true, numFailedTests: 0, numFailedTestSuites: 0, numPassedTests: 1, numPendingTests: 0, numTodoTests: 0,
    testResults: [{ testResults: [{ title: 'renders the actual home screen', ancestorTitles: ['app-launch'], status: 'passed', duration: 5, failureMessages: [] }] }] };
  new Reporter().onRunComplete(null, result); assert.throws(verifyResults);
  fs.writeFileSync('artifacts/detox/detox-home-visible.png', 'test fixture'); verifyResults();
  new Reporter().onRunComplete(null, { ...result, numPendingTests: 1 }); assert.throws(verifyResults);
  new Reporter().onRunComplete(null, { ...result, success: false }); verifyResults();
  new Reporter().onRunComplete(null, { ...result, wasInterrupted: true }); assert.throws(verifyResults);
  new Reporter().onRunComplete(null, { ...result, success: false, numFailedTestSuites: 1, numPassedTests: 0,
    testResults: [{ testExecError: {}, failureMessage: 'native <init> failed & stopped', testResults: [] }] });
  assert.match(fs.readFileSync('artifacts/detox/junit.xml', 'utf8'), /errors="1"/);
  assert.match(fs.readFileSync('artifacts/detox/junit.xml', 'utf8'), /&lt;init&gt; failed &amp; stopped/);
  assert.throws(verifyResults);
}));
