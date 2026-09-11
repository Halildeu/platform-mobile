/* global __dirname */
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
const marker = '// Workcube PCM background v1';

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('expo-audio source changed; review PCM background integration before building');
  return source.replace(before, after);
}
function patchStream(source) {
  source = source.replace(/\r\n/g, '\n');
  if (source.includes(marker)) return source;
  source = replaceOnce(source, '    emitStatus()\n\n    startCaptureLoop(recorder, config)',
    `    ${marker}\n    try {\n      val context = appContext?.reactContext ?: throw IllegalStateException("Audio context unavailable")\n      expo.modules.audio.service.PcmCaptureService.attach(context, this)\n    } catch (error: Exception) {\n      stop()\n      throw AudioStreamInitializationException("Background recording service could not start")\n    }\n    emitStatus()\n\n    if (isStreaming) startCaptureLoop(recorder, config)`);
  source = replaceOnce(source,
    '    audioRecord?.stop()\n    audioRecord?.release()\n    audioRecord = null\n    emitStatus()',
    '    val recorder = audioRecord\n    audioRecord = null\n    try { recorder?.stop() } finally {\n      try { recorder?.release() } finally {\n        appContext?.reactContext?.let { expo.modules.audio.service.PcmCaptureService.detach(it, this) }\n        emitStatus()\n      }\n    }');
  return source;
}
function patchModule(source) {
  source = source.replace(/\r\n/g, '\n');
  if (source.includes(marker)) return source;
  return replaceOnce(source, '    Name("ExpoAudio")',
    `    Name("ExpoAudio")\n    ${marker}\n    Function("configurePcmBackground") { enabled: Boolean ->\n      expo.modules.audio.service.PcmCaptureService.enabled = enabled\n    }`);
}
function applyNative(root) {
  const audioRoot = path.dirname(require.resolve('expo-audio/package.json', { paths: [root] }));
  if (JSON.parse(fs.readFileSync(path.join(audioRoot, 'package.json'), 'utf8')).version !== '57.0.4') throw new Error('PCM service is reviewed for expo-audio 57.0.4 only');
  const dir = path.join(audioRoot, 'android/src/main/java/expo/modules/audio');
  // Prepare all transformations before writing, so an upstream mismatch leaves sources intact.
  const stream = patchStream(fs.readFileSync(path.join(dir, 'AudioStream.kt'), 'utf8'));
  const moduleSource = patchModule(fs.readFileSync(path.join(dir, 'AudioModule.kt'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'AudioStream.kt'), stream);
  fs.writeFileSync(path.join(dir, 'AudioModule.kt'), moduleSource);
  fs.copyFileSync(path.join(__dirname, 'native/PcmCaptureService.kt'), path.join(dir, 'service/PcmCaptureService.kt'));
}
function patchIosStream(source) {
  source = source.replace(/\r\n/g, '\n');
  if (source.includes(marker)) return source;
  source = replaceOnce(source, 'class AudioStream: SharedObject {', `class AudioStream: SharedObject {
  ${marker}
  static var backgroundRecordingEnabled = false
  private var backgroundDeadline: DispatchWorkItem?
  private var recordingObservers: [NSObjectProtocol] = []`);
  source = replaceOnce(source, '    super.init()', `    super.init()
    let center = NotificationCenter.default
    recordingObservers.append(center.addObserver(forName: AVAudioSession.interruptionNotification,
      object: AVAudioSession.sharedInstance(), queue: .main) { [weak self] notification in
      if let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
        raw == AVAudioSession.InterruptionType.began.rawValue { self?.stop() }
    })
    recordingObservers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification,
      object: AVAudioSession.sharedInstance(), queue: .main) { [weak self] _ in self?.stop() })`);
  source = replaceOnce(source, '  func stop() {', `  func stop() {
    backgroundDeadline?.cancel()
    backgroundDeadline = nil`);
  source = replaceOnce(source, '  private func emitStatus() {', `  private func emitStatus() {
    if isStreaming && Self.backgroundRecordingEnabled && backgroundDeadline == nil {
      let deadline = DispatchWorkItem { [weak self] in self?.stop() }
      backgroundDeadline = deadline
      DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: deadline)
    }`);
  return replaceOnce(source, '  deinit {\n    stop()', '  deinit {\n    recordingObservers.forEach { NotificationCenter.default.removeObserver($0) }\n    stop()');
}
function patchIosModule(source) {
  source = source.replace(/\r\n/g, '\n');
  if (source.includes(marker)) return source;
  return replaceOnce(source, '    Name("ExpoAudio")', `    Name("ExpoAudio")
    ${marker}
    Function("configurePcmBackground") { (enabled: Bool) in
      AudioStream.backgroundRecordingEnabled = enabled
    }`);
}
function applyIos(root) {
  const audioRoot = path.dirname(require.resolve('expo-audio/package.json', { paths: [root] }));
  if (JSON.parse(fs.readFileSync(path.join(audioRoot, 'package.json'), 'utf8')).version !== '57.0.4') throw new Error('PCM integration requires expo-audio 57.0.4 review');
  const dir = path.join(audioRoot, 'ios');
  const stream = patchIosStream(fs.readFileSync(path.join(dir, 'AudioStream.swift'), 'utf8'));
  const moduleSource = patchIosModule(fs.readFileSync(path.join(dir, 'AudioModule.swift'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'AudioStream.swift'), stream);
  fs.writeFileSync(path.join(dir, 'AudioModule.swift'), moduleSource);
}
module.exports = function withPcmBackground(config) {
  config = withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application[0];
    application.service ??= [];
    const name = 'expo.modules.audio.service.PcmCaptureService';
    if (!application.service.some(item => item.$['android:name'] === name)) application.service.push({ $: {
      'android:name': name, 'android:exported': 'false', 'android:foregroundServiceType': 'microphone', 'android:stopWithTask': 'true',
    } });
    return mod;
  });
  config = withDangerousMod(config, ['android', async (mod) => { applyNative(mod.modRequest.projectRoot); return mod; }]);
  return withDangerousMod(config, ['ios', async (mod) => { applyIos(mod.modRequest.projectRoot); return mod; }]);
};
module.exports.patchStream = patchStream;
module.exports.patchModule = patchModule;
module.exports.applyNative = applyNative;
module.exports.patchIosStream = patchIosStream;
module.exports.patchIosModule = patchIosModule;
