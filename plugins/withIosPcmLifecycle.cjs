/* global __dirname */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const normalize = value => value.replace(/\r\n/g, '\n');
const digest = value => createHash('sha256').update(normalize(value)).digest('hex');
const template = () => normalize(fs.readFileSync(path.join(__dirname, 'ios-pcm/AudioStream.swift'), 'utf8'));
const originalStreamHash = '0ba1c8e66ea47809cc0ebfc16215ecb22426c7c7ee797b5ef562a6e564846bbb';
const originalModuleHash = '988bad3ed7eadf2b79d0de2a02529862e7e04cf5d52c9e8ddb65b55acb133e52';
const anchor = '    Class(AudioStream.self) {\n';
const extension = `      // Workcube PCM lifecycle v1: per-instance capability, never a global opt-in.
      Property("workcubePcmLifecycleVersion") { (_: AudioStream) in 1 }
      Property("workcubeCaptureId") { (stream: AudioStream) in stream.workcubeCaptureId }
      Property("workcubeLastStopReason") { (stream: AudioStream) in stream.workcubeLastStopReason }
      Function("configureBackgroundCapture") { (stream: AudioStream, enabled: Bool) in
        try stream.configureBackgroundCapture(enabled)
      }
`;

function patchStream(source) {
  source = normalize(source);
  const target = template();
  if (source === target) return source;
  if (digest(source) !== originalStreamHash) throw new Error('Unrecognized Expo AudioStream source; review iOS PCM lifecycle before building.');
  return target;
}
function patchModule(source) {
  source = normalize(source);
  const restored = source.replace(anchor + extension, anchor);
  if (digest(restored) !== originalModuleHash || restored.split(anchor).length !== 2) {
    throw new Error('Unrecognized Expo AudioModule source; review iOS PCM lifecycle before building.');
  }
  return restored.replace(anchor, anchor + extension);
}
function applyIos(root) {
  const audioRoot = path.dirname(require.resolve('expo-audio/package.json', { paths: [root] }));
  if (JSON.parse(fs.readFileSync(path.join(audioRoot, 'package.json'), 'utf8')).version !== '57.0.4') {
    throw new Error('iOS PCM lifecycle requires reviewed expo-audio 57.0.4.');
  }
  const streamFile = path.join(audioRoot, 'ios/AudioStream.swift');
  const moduleFile = path.join(audioRoot, 'ios/AudioModule.swift');
  // Validate both inputs before writing either. Unknown/partial patches fail.
  const stream = patchStream(fs.readFileSync(streamFile, 'utf8'));
  const module = patchModule(fs.readFileSync(moduleFile, 'utf8'));
  fs.writeFileSync(streamFile, stream);
  fs.writeFileSync(moduleFile, module);
}
module.exports = config => withDangerousMod(config, ['ios', async config => {
  applyIos(config.modRequest.projectRoot);
  return config;
}]);
module.exports.patchStream = patchStream;
module.exports.patchModule = patchModule;
module.exports.applyIos = applyIos;
