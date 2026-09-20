import { spawnSync } from 'node:child_process';

export const PROJECT_ID = '3597d06c-21ec-4908-b453-e72f219d5758';
export const APP_ID = 'com.workcube.meeting';
export const EAS_VERSION = '24.7.0';
export const CHANNELS = ['development', 'preview', 'production'];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SHA = /^[0-9a-f]{40}$/;
export const FINGERPRINT = /^[0-9a-f]{40,64}$/;
export function requireValue(ok, message) { if (!ok) throw new Error(message); }

export function validateConfig(config, platform) {
  requireValue(['android', 'ios'].includes(platform), 'Invalid platform');
  requireValue(config?.extra?.eas?.projectId === PROJECT_ID, 'Unexpected Expo project');
  requireValue(config.android?.package === APP_ID && config.ios?.bundleIdentifier === APP_ID, 'Unexpected application identifier');
  const runtime = config[platform]?.runtimeVersion ?? config.runtimeVersion;
  requireValue(runtime?.policy === 'fingerprint', 'OTA requires a fingerprint native runtime');
  requireValue(config.updates?.enabled === true && config.updates.url === `https://u.expo.dev/${PROJECT_ID}`, 'OTA is disabled or has an unexpected server');
  requireValue(!config.updates.codeSigningCertificate && !config.updates.codeSigningMetadata, 'OTA code signing requires a separately verified signing workflow');
}

export function validateOtaBuild(build, input) {
  requireValue(build?.id === input.buildId && build.status === 'FINISHED' && !build.error, 'Native build is not finished');
  requireValue(build.app?.id === PROJECT_ID && build.appIdentifier === APP_ID, 'Native build belongs to another project or application');
  requireValue(build.platform === input.platform.toUpperCase() && build.isForIosSimulator === false, 'Wrong native platform or unknown/simulator build');
  requireValue(build.buildProfile === `ota-${input.channel}` && build.updateChannel?.name === input.channel, 'Native build channel/profile mismatch');
  requireValue(build.distribution === (input.channel === 'production' ? 'STORE' : 'INTERNAL'), 'Native build distribution mismatch');
  const runtime = build.runtime?.version;
  requireValue(FINGERPRINT.test(runtime ?? '') && build.fingerprint?.hash === runtime, 'Native build fingerprint/runtime mismatch');
  requireValue(SHA.test(build.gitCommitHash ?? '') && Boolean(build.artifacts?.applicationArchiveUrl), 'Native build lacks source/archive evidence');
  return runtime;
}

// Capture, never echo complete Expo config, child stderr, credentials or signed URLs.
export function command(executable, args, timeout = 60000) {
  const result = spawnSync(executable, args, { shell: false, encoding: 'utf8', timeout,
    maxBuffer: 8 * 1024 * 1024, env: { ...process.env, CI: '1', NO_COLOR: '1', EXPO_NO_TELEMETRY: '1' } });
  requireValue(!result.error && result.status === 0, 'Release command failed; raw output withheld');
  return result.stdout.trim();
}
export function jsonCommand(executable, args, timeout) {
  const output = command(executable, args, timeout);
  try { return JSON.parse(output); } catch { throw new Error('Release metadata is not JSON'); }
}
export function verifyCli() {
  requireValue(command('eas', ['--version']).startsWith(`eas-cli/${EAS_VERSION} `), 'Unexpected EAS CLI version');
  requireValue(!process.env.EXPO_LOCAL && !process.env.EXPO_STAGING, 'Nonstandard Expo API is not allowed');
}
export function resolvedConfig() {
  return jsonCommand(process.execPath, ['node_modules/expo/bin/cli', 'config', '--json']);
}
export function resolvedRuntime(platform) {
  const result = jsonCommand(process.execPath, ['node_modules/expo-updates/bin/cli.js', 'runtimeversion:resolve', '--platform', platform], 120000);
  requireValue(FINGERPRINT.test(result.runtimeVersion ?? ''), 'Local native fingerprint is missing');
  return result.runtimeVersion;
}
