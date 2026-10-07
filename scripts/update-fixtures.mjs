// Synthetic metadata shaped from eas-cli 24.7.0 queries; no account credentials.
import { PROJECT_ID, APP_ID } from './release-common.mjs';
export const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const runtime = 'a'.repeat(40);
export const input = { operation: 'publish-5', channel: 'preview', platform: 'android', buildId: id(1), sha: 'b'.repeat(40) };
export const config = { extra: { eas: { projectId: PROJECT_ID } }, android: { package: APP_ID }, ios: { bundleIdentifier: APP_ID },
  runtimeVersion: { policy: 'fingerprint' }, updates: { enabled: true, url: `https://u.expo.dev/${PROJECT_ID}` } };
export const build = { id: id(1), status: 'FINISHED', error: null, app: { id: PROJECT_ID }, appIdentifier: APP_ID,
  platform: 'ANDROID', isForIosSimulator: false, buildProfile: 'ota-preview', updateChannel: { name: 'preview' }, distribution: 'INTERNAL',
  runtime: { version: runtime }, fingerprint: { hash: runtime }, gitCommitHash: 'c'.repeat(40), artifacts: { applicationArchiveUrl: 'https://example.invalid/native.apk' } };
export function update(n, overrides = {}) {
  return { id: id(100 + n), group: id(n), createdAt: `2026-09-20T12:${String(n).padStart(2, '0')}:00.000Z`, platform: 'android',
    runtime: { version: runtime }, branch: { id: id(2), name: 'preview' }, isRollBackToEmbedded: false, isGitWorkingTreeDirty: false,
    awaitingCodeSigningInfo: false, codeSigningInfo: null,
    gitCommitHash: 'd'.repeat(40), manifestFragment: JSON.stringify({ launchAsset: { key: `asset-${n}` }, assets: [] }), rolloutPercentage: null,
    rolloutControlUpdate: null, ...overrides };
}
export function snapshot(rows = []) {
  return { app: { byId: { id: PROJECT_ID, updateChannelByName: { id: id(3), name: 'preview', isPaused: false,
    branchMapping: JSON.stringify({ version: 0, data: [{ branchId: id(2), branchMappingLogic: 'true' }] }) },
  updateBranchByName: { id: id(2), name: 'preview', updates: rows } } } };
}
export function state(rows = [], extra = {}) {
  return { build: globalThis.structuredClone(build), localRuntime: runtime, snapshot: snapshot(rows), groups: Object.fromEntries(rows.map(row => [row.group, [row]])), ...extra };
}
