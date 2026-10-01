const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const binaries = {
  android: ['android/app/build/outputs/apk/release/app-release.apk', 'android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk'],
  ios: ['ios/build/Build/Products/Release-iphonesimulator/WorkcubeMeeting.app'],
};
function fingerprint(platform, commit) {
  assert.match(commit || '', /^[a-f0-9]{40}$/); assert.ok(binaries[platform]);
  const files = [];
  function visit(file) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) { files.push({ path: file, link: fs.readlinkSync(file) }); return; }
    if (stat.isDirectory()) { for (const name of fs.readdirSync(file).sort()) visit(file + '/' + name); return; }
    assert.ok(stat.isFile());
    const bytes = fs.readFileSync(file);
    files.push({ path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  binaries[platform].forEach(visit); assert.ok(files.length);
  return { schema: 'mobile-detox-packages/v1', platform, commit, files };
}
function verifyResults() {
  const result = JSON.parse(fs.readFileSync('artifacts/detox/jest-result.json', 'utf8'));
  // Jest can report `success: false` from Detox's custom environment even when
  // the native suite completed and every assertion passed. Validate the
  // concrete counters and interruption state instead of that derived flag.
  assert.notEqual(result.wasInterrupted, true);
  assert.equal(result.numFailedTests, 0); assert.equal(result.numFailedTestSuites, 0);
  assert.equal(result.numPassedTests, 1); assert.equal(result.numPendingTests, 0); assert.equal(result.numTodoTests, 0);
  const tests = result.testResults.flatMap(suite => suite.testResults);
  assert.equal(tests.length, 1); assert.equal(tests[0].title, 'renders the actual home screen'); assert.equal(tests[0].status, 'passed');
  assert.ok(fs.statSync('artifacts/detox/junit.xml').size > 0);
  const screenshots = [];
  function visit(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.name.includes('detox-home-visible') && entry.name.endsWith('.png') && fs.statSync(file).size > 0) screenshots.push(file);
  } }
  visit('artifacts/detox'); assert.ok(screenshots.length, 'Missing successful native home screenshot');
}
if (require.main === module) {
  const [mode, platform, commit] = process.argv.slice(2);
  if (mode === 'results') verifyResults();
  else {
    assert.ok(['seal', 'verify'].includes(mode));
    const current = fingerprint(platform, commit);
    fs.mkdirSync('artifacts/detox', { recursive: true });
    const file = `artifacts/detox/packages-${platform}.json`;
    if (mode === 'seal') fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n', { flag: 'wx' });
    else assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), current, 'Native test package changed');
  }
}
module.exports = { fingerprint, verifyResults };
