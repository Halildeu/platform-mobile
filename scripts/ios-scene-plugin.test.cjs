const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const plugin = require('../plugins/withIosSceneLifecycle.cjs');

const template = fs.readFileSync(
  path.join(__dirname, '../plugins/ios-scene/AppDelegate.swift'),
  'utf8');

test('patches the reviewed Expo AppDelegate once', () => {
  const patched = plugin.patchAppDelegate(template);
  assert.match(patched, /Workcube UIScene lifecycle v1/);
  assert.match(patched, /SceneDelegate creates the window/);
  assert.match(patched, /func startReactNative\(in window: UIWindow/);
  assert.equal(plugin.patchAppDelegate(patched), patched);
});

test('rejects an unknown AppDelegate instead of making a partial patch', () => {
  assert.throws(() => plugin.patchAppDelegate('class AppDelegate {}'), /Unrecognized Expo AppDelegate/);
});

test('adds the single-scene manifest and rejects an unrelated existing manifest', () => {
  const result = plugin.addSceneManifest({ CFBundleName: 'Workcube' });
  assert.equal(result.UIApplicationSceneManifest.UIApplicationSupportsMultipleScenes, false);
  assert.equal(
    result.UIApplicationSceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName,
    '$(PRODUCT_MODULE_NAME).SceneDelegate');
  assert.throws(
    () => plugin.addSceneManifest({ UIApplicationSceneManifest: { unexpected: true } }),
    /requires explicit review/);
});

test('preserves notification and deep-link handoff in SceneDelegate', () => {
  assert.match(plugin.sceneDelegate, /connectionOptions\.urlContexts/);
  assert.match(plugin.sceneDelegate, /connectionOptions\.notificationResponse/);
  assert.match(plugin.sceneDelegate, /openURLContexts/);
  assert.match(plugin.sceneDelegate, /continue userActivity/);
});

test('app config enables UIScene before the existing PCM lifecycle patch', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8')).expo;
  const scene = config.plugins.indexOf('./plugins/withIosSceneLifecycle.cjs');
  const pcm = config.plugins.indexOf('./plugins/withIosPcmLifecycle.cjs');
  assert.ok(scene >= 0 && pcm > scene);
});
