const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { patchStream, patchModule, patchIosStream, patchIosModule } = require('../plugins/withPcmBackground.cjs');
const root = path.dirname(require.resolve('expo-audio/package.json'));
test('Android patch is repeatable and keeps native detach/stop lifecycle', () => {
  const patched = patchStream(fs.readFileSync(path.join(root, 'android/src/main/java/expo/modules/audio/AudioStream.kt'), 'utf8'));
  assert.equal(patchStream(patched), patched);
  assert.match(patched, /PcmCaptureService.attach/); assert.match(patched, /PcmCaptureService.detach/);
  assert.throws(() => patchStream('unexpected source'));
});
test('iOS patch covers interruption, reset, native deadline and observer cleanup', () => {
  const patched = patchIosStream(fs.readFileSync(path.join(root, 'ios/AudioStream.swift'), 'utf8'));
  assert.equal(patchIosStream(patched), patched);
  for (const name of ['interruptionNotification', 'mediaServicesWereResetNotification', 'backgroundDeadline?.cancel()', 'removeObserver']) assert.ok(patched.includes(name));
  assert.throws(() => patchIosStream('unexpected source'));
});
test('capability methods are inserted exactly once on both platforms', () => {
  for (const patch of [patchModule, patchIosModule]) {
    const result = patch('    Name("ExpoAudio")');
    assert.equal(patch(result), result);
    assert.equal(result.split('configurePcmBackground').length, 2);
    assert.throws(() => patch('unknown module'));
  }
});
