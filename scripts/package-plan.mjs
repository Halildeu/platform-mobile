import { APP_ID, CHANNELS, FINGERPRINT, PROJECT_ID, SHA, UUID, requireValue, validateConfig } from './release-common.mjs';

export const DIGEST = /^[0-9a-f]{64}$/;
export function validatePackageInput(input) {
  requireValue(['build', 'submit'].includes(input.operation), 'Invalid package operation');
  requireValue(['android', 'ios'].includes(input.platform) && CHANNELS.includes(input.channel), 'Invalid package target');
  requireValue(typeof input.ota === 'boolean' && SHA.test(input.sha ?? ''), 'Exact source commit and OTA choice are required');
  requireValue(!input.buildId || UUID.test(input.buildId), 'Invalid build UUID');
  requireValue(!input.submissionId || UUID.test(input.submissionId), 'Invalid submission UUID');
  if (input.operation === 'submit') {
    requireValue(input.channel === 'production' && UUID.test(input.buildId ?? '') && DIGEST.test(input.digest ?? ''), 'Submit requires an exact store build, source commit and archive SHA256');
    if (input.platform === 'ios') requireValue(/^[0-9]{1,30}$/.test(input.ascAppId ?? ''), 'Institutional App Store Connect app ID is required');
  } else requireValue(!input.submissionId, 'A build cannot resume a submission');
  return { profile: `${input.ota ? 'ota-' : ''}${input.channel}`,
    simulator: input.platform === 'ios' && input.channel === 'development' && !input.ota,
    distribution: input.channel === 'production' ? 'STORE' : 'INTERNAL' };
}

export function packageConfig(input, { appConfig, buildProfile }) {
  const expected = validatePackageInput(input);
  requireValue(appConfig?.extra?.eas?.projectId === PROJECT_ID && appConfig.android?.package === APP_ID && appConfig.ios?.bundleIdentifier === APP_ID, 'Unexpected package project/application');
  requireValue(buildProfile?.channel === input.channel && buildProfile.environment === input.channel, 'Unexpected package channel/environment');
  requireValue(buildProfile.credentialsSource === 'remote', 'Use preconfigured EAS signing credentials');
  requireValue(buildProfile.distribution?.toUpperCase() === expected.distribution, 'Unexpected package distribution');
  if (input.platform === 'ios') requireValue((buildProfile.simulator === true) === expected.simulator, 'Unexpected simulator profile');
  if (input.platform === 'android' && expected.distribution === 'STORE') requireValue(buildProfile.buildType === 'app-bundle', 'Play submission requires an Android App Bundle');
  requireValue(buildProfile.env?.MOBILE_OTA_ENABLED === (input.ota ? '1' : '0'), 'Profile must explicitly select OTA mode');
  if (input.ota) validateConfig(appConfig, input.platform);
  else requireValue(appConfig.updates?.enabled === false, 'Normal profiles must keep OTA disabled');
  return expected;
}

// Whitelist the metadata we retain; never store archive URLs, credentials or logs.
export function inspectBuild(build, input, finished = true) {
  const expected = validatePackageInput(input);
  requireValue(build?.id === input.buildId && build.app?.id === PROJECT_ID && build.appIdentifier === APP_ID, 'Build identity/project/application mismatch');
  requireValue(build.platform === input.platform.toUpperCase() && build.gitCommitHash === input.sha, 'Build platform/source mismatch');
  requireValue(build.buildProfile === expected.profile && build.updateChannel?.name === input.channel && build.distribution === expected.distribution, 'Build profile/channel/distribution mismatch');
  requireValue(build.isForIosSimulator === expected.simulator, 'Build simulator status mismatch or unknown');
  if (input.ota && build.status === 'FINISHED') requireValue(FINGERPRINT.test(build.runtime?.version ?? '') && build.runtime.version === build.fingerprint?.hash, 'Build native fingerprint mismatch');
  requireValue(!build.error && !['ERRORED', 'CANCELED', 'PENDING_CANCEL'].includes(build.status), 'EAS build failed or was canceled');
  requireValue(['NEW', 'IN_QUEUE', 'IN_PROGRESS', 'FINISHED'].includes(build.status), 'Unknown build status');
  if (finished) requireValue(build.status === 'FINISHED' && build.artifacts?.applicationArchiveUrl, 'Build/archive is not ready');
  return { buildId: build.id, sourceCommit: build.gitCommitHash, platform: input.platform,
    profile: build.buildProfile, channel: input.channel, distribution: build.distribution,
    simulator: build.isForIosSimulator, status: build.status,
    appVersion: build.appVersion, appBuildVersion: build.appBuildVersion,
    runtime: build.runtime?.version ?? null, fingerprint: build.fingerprint?.hash ?? null };
}

export function submitProfile(input, eas) {
  validatePackageInput(input);
  const profile = eas.submit?.internal?.[input.platform];
  const expected = input.platform === 'android'
    ? { applicationId: APP_ID, track: 'internal', releaseStatus: 'completed', changesNotSentForReview: false }
    : { bundleIdentifier: APP_ID };
  requireValue(profile && Object.keys(profile).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => profile[key] === value), 'Internal submit profile changed; review destination/credentials first');
  return expected;
}

export function materializeSubmitConfig(input, eas) {
  requireValue(input.operation === 'submit', 'Only exact-ID submission can materialize store configuration');
  submitProfile(input, eas);
  const configured = globalThis.structuredClone(eas);
  // EAS24.7.0 does not interpolate ascAppId from env; API-key fields alone do.
  if (input.platform === 'ios') configured.submit.internal.ios.ascAppId = input.ascAppId;
  return configured;
}

export function inspectSubmission(submission, input, finished = true) {
  validatePackageInput(input);
  requireValue(submission?.id === input.submissionId && submission.app?.id === PROJECT_ID && submission.platform === input.platform.toUpperCase() && submission.submittedBuild?.id === input.buildId, 'Submission identity/project/platform/build mismatch');
  if (input.platform === 'android') requireValue(submission.androidConfig?.track === 'internal' && submission.androidConfig.releaseStatus === 'COMPLETED' && submission.androidConfig.rollout == null, 'Unexpected Play release destination');
  else requireValue(submission.iosConfig?.ascAppIdentifier === input.ascAppId, 'Unexpected App Store Connect destination');
  requireValue(!submission.error && !['ERRORED', 'CANCELED'].includes(submission.status), 'EAS submission failed or was canceled');
  requireValue(['AWAITING_BUILD', 'IN_QUEUE', 'IN_PROGRESS', 'FINISHED'].includes(submission.status), 'Unknown submission status');
  if (finished) requireValue(submission.status === 'FINISHED', 'Submission is not finished');
  return { submissionId: submission.id, buildId: input.buildId, platform: input.platform,
    status: submission.status, destination: input.platform === 'android' ? 'play-internal' : 'app-store-connect',
    ascAppId: input.platform === 'ios' ? input.ascAppId : undefined };
}

export function buildArgs(input) {
  const { profile } = validatePackageInput(input);
  requireValue(!input.buildId, 'Resume cannot create another build');
  return ['build', '--platform', input.platform, '--profile', profile, '--non-interactive', '--freeze-credentials', '--no-wait', '--json'];
}
export function submitArgs(input) {
  validatePackageInput(input);
  requireValue(!input.submissionId, 'Resume cannot create another submission');
  return ['submit', '--platform', input.platform, '--profile', 'internal', '--id', input.buildId, '--non-interactive', '--no-wait', '--no-auto-testflight-setup'];
}
export function buildIdFromOutput(output) {
  let builds;
  try { builds = JSON.parse(output); } catch { throw new Error('Build command identity is unavailable'); }
  requireValue(Array.isArray(builds) && builds.length === 1 && UUID.test(builds[0]?.id ?? ''), 'Build command must identify exactly one build');
  return builds[0].id;
}
export function submissionIdFromOutput(output) {
  // Exact eas-cli 24.7.0 single-platform output. Do not guess from an arbitrary UUID.
  const matches = [...output.matchAll(/^Submission details: https:\/\/expo\.dev\/accounts\/[^\s/]+\/projects\/[^\s/]+\/submissions\/([0-9a-f-]+)\s*$/gm)];
  requireValue(matches.length === 1 && UUID.test(matches[0][1]), 'Submission command identity is unavailable or ambiguous');
  return matches[0][1];
}
