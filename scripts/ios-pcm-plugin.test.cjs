const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { patchStream, patchModule, applyIos } = require('../plugins/withIosPcmLifecycle.cjs');
const root = path.dirname(require.resolve('expo-audio/package.json'));
const stream = fs.readFileSync(path.join(root, 'ios/AudioStream.swift'), 'utf8');
const moduleSource = fs.readFileSync(path.join(root, 'ios/AudioModule.swift'), 'utf8');

test('iOS integration is deterministic and repeatable on the reviewed source', () => {
  const patched = patchStream(stream);
  assert.equal(patchStream(patched), patched);
  assert.equal(patchStream(stream.replace(/\r?\n/g, '\r\n')), patched);
  const patchedModule = patchModule(moduleSource);
  assert.equal(patchModule(patchedModule), patchedModule);
  assert.equal(patchedModule.split('Property("workcubePcmLifecycleVersion")').length, 2);
  // A marker alone must never make an unknown patch eligible for compilation.
  assert.throws(() => patchStream(patched + '\n// drift'));
  assert.throws(() => patchModule(patchedModule.replace('in 1 }', 'in 2 }')));
  assert.throws(() => patchStream(stream + '\n// upstream changed'));
  assert.throws(() => patchModule(moduleSource + '\n// upstream changed'));
});

test('version and both native files are validated before any mutation', t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-pcm-plugin-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const audio = path.join(fixture, 'node_modules/expo-audio');
  fs.mkdirSync(path.join(audio, 'ios'), { recursive: true });
  const packagePath = path.join(audio, 'package.json');
  const streamPath = path.join(audio, 'ios/AudioStream.swift');
  const modulePath = path.join(audio, 'ios/AudioModule.swift');
  fs.writeFileSync(packagePath, JSON.stringify({ version: '57.0.5' }));
  fs.writeFileSync(streamPath, stream);
  fs.writeFileSync(modulePath, moduleSource);
  assert.throws(() => applyIos(fixture), /57.0.4/);
  assert.equal(fs.readFileSync(streamPath, 'utf8'), stream);
  fs.writeFileSync(packagePath, JSON.stringify({ version: '57.0.4' }));
  fs.writeFileSync(modulePath, 'unknown source');
  assert.throws(() => applyIos(fixture), /AudioModule/);
  assert.equal(fs.readFileSync(streamPath, 'utf8'), stream);
  fs.writeFileSync(modulePath, moduleSource);
  applyIos(fixture);
  assert.equal(fs.readFileSync(streamPath, 'utf8'), patchStream(stream));
  assert.equal(fs.readFileSync(modulePath, 'utf8'), patchModule(moduleSource));
  applyIos(fixture);
});

test('active application uses iOS lifecycle plugin, not obsolete timed recording patch', () => {
  const config = require('../app.json').expo;
  assert.ok(config.plugins.includes('./plugins/withIosPcmLifecycle.cjs'));
  assert.ok(!config.plugins.includes('./plugins/withPcmBackground.cjs'));
  assert.ok(config.ios.infoPlist.UIBackgroundModes.includes('audio'));
  assert.deepEqual(require('../modules/workcube-pcm-background/expo-module.config.json').platforms, ['android']);
});
