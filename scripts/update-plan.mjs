import { createHash } from 'node:crypto';
import { CHANNELS, PROJECT_ID, UUID, SHA, requireValue, validateConfig, validateOtaBuild } from './release-common.mjs';

export const OPERATIONS = ['publish-5', 'advance-25', 'advance-100', 'revert-current', 'rollback-previous', 'rollback-embedded'];
export function validateInput(input) {
  requireValue(OPERATIONS.includes(input.operation) && CHANNELS.includes(input.channel), 'Invalid update operation/channel');
  requireValue(['android', 'ios'].includes(input.platform), 'Invalid platform');
  requireValue(UUID.test(input.buildId ?? '') && SHA.test(input.sha ?? ''), 'Expected exact native build and source commit');
  if (input.operation !== 'publish-5') requireValue(UUID.test(input.group ?? ''), 'Expected current update group');
  if (input.operation === 'rollback-previous') requireValue(UUID.test(input.previousGroup ?? '') && input.previousGroup !== input.group, 'Expected a distinct previous group');
}
const active = row => row != null && row.percentage != null && row.percentage < 100;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function digestManifest(raw, embedded) {
  // An embedded directive has no JS manifest to compare; the native build is
  // its content identity. Expo may return an empty manifestFragment for it.
  if (embedded) return null;
  requireValue(typeof raw === 'string', 'Missing update manifest');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Malformed update manifest'); }
  requireValue(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'Malformed update manifest');
  return createHash('sha256').update(JSON.stringify(canonical(parsed))).digest('hex');
}

function updateRecord(raw, input, runtime, branchId) {
  requireValue(raw && UUID.test(raw.id ?? '') && UUID.test(raw.group ?? ''), 'Missing update identity');
  requireValue(raw.branch?.id === branchId && raw.branch.name === input.channel && raw.runtime?.version === runtime && raw.platform === input.platform, 'Update project/branch/runtime/platform mismatch');
  requireValue(typeof raw.isRollBackToEmbedded === 'boolean' && typeof raw.isGitWorkingTreeDirty === 'boolean' && !raw.isGitWorkingTreeDirty, 'Unknown or dirty update source');
  // CLI revert deletes the active rollout before republishing the control.
  // Do not get that far if republishing would require an unavailable OTA key.
  requireValue(raw.awaitingCodeSigningInfo === false && raw.codeSigningInfo === null, 'Signed or incomplete OTA update requires a signing-aware workflow');
  requireValue(raw.rolloutPercentage === null || (Number.isInteger(raw.rolloutPercentage) && raw.rolloutPercentage >= 0 && raw.rolloutPercentage <= 100), 'Missing or invalid rollout percentage');
  const control = raw.rolloutControlUpdate;
  requireValue(control === null || (control && UUID.test(control.id ?? '') && UUID.test(control.group ?? '') && control.group !== raw.group), 'Missing or invalid rollout control');
  requireValue(Number.isFinite(Date.parse(raw.createdAt)), 'Missing update creation time');
  requireValue(SHA.test(raw.gitCommitHash ?? '') || (raw.isRollBackToEmbedded && raw.gitCommitHash === null), 'Missing update source commit');
  return { id: raw.id, group: raw.group, createdAt: raw.createdAt, runtime, platform: raw.platform,
    embedded: raw.isRollBackToEmbedded, percentage: raw.rolloutPercentage,
    control: control === null ? null : { id: control.id, group: control.group },
    sha: raw.gitCommitHash, manifestHash: digestManifest(raw.manifestFragment, raw.isRollBackToEmbedded) };
}

// Both objects are returned beneath app.byId(PROJECT_ID). No arbitrary group can
// acquire project membership just by knowing its UUID.
export function inspectSnapshot(snapshot, input, runtime) {
  const app = snapshot?.app?.byId;
  requireValue(app?.id === PROJECT_ID, 'Remote project mismatch');
  const channel = app.updateChannelByName, branch = app.updateBranchByName;
  requireValue(channel?.name === input.channel && UUID.test(channel.id ?? '') && channel.isPaused === false, 'Missing, wrong or paused channel');
  requireValue(branch?.name === input.channel && UUID.test(branch.id ?? ''), 'Missing canonical channel branch');
  let mapping;
  try { mapping = JSON.parse(channel.branchMapping); } catch { throw new Error('Malformed channel mapping'); }
  requireValue(mapping?.version === 0 && mapping.data?.length === 1 && mapping.data[0].branchId === branch.id && mapping.data[0].branchMappingLogic === 'true', 'Ambiguous channel mapping or branch rollout');
  requireValue(Array.isArray(branch.updates) && branch.updates.length <= 2, 'Malformed update listing');
  const rows = branch.updates.map(raw => updateRecord(raw, input, runtime, branch.id));
  requireValue(new Set(rows.map(row => row.group)).size === rows.length, 'Duplicate update groups');
  if (rows.length === 2) requireValue(Date.parse(rows[0].createdAt) > Date.parse(rows[1].createdAt), 'Ambiguous update order');
  return { channelId: channel.id, branchId: branch.id, current: rows[0] ?? null, previous: rows[1] ?? null };
}

export function inspectGroup(rawGroup, expected, input, runtime, branchId) {
  // CLI edit/revert affect whole groups. Never let an Android operation touch iOS.
  requireValue(Array.isArray(rawGroup) && rawGroup.length === 1, 'Missing or mixed-platform update group');
  const record = updateRecord(rawGroup[0], input, runtime, branchId);
  requireValue(record.group === expected.group && record.id === expected.id, 'Update group changed during inspection');
  return record;
}

export function updatePlan(input, config, state) {
  validateInput(input);
  validateConfig(config, input.platform);
  const runtime = validateOtaBuild(state.build, input);
  // Recovery of an older installed runtime must remain possible after native code changes.
  if (input.operation === 'publish-5') requireValue(state.localRuntime === runtime, 'Native changes require a new tested build');
  const base = inspectSnapshot(state.snapshot, input, runtime);
  const { current, previous, branchId } = base;
  if (current) requireValue(JSON.stringify(inspectGroup(state.groups?.[current.group], current, input, runtime, branchId)) === JSON.stringify(current), 'Current update metadata changed');
  if (input.operation !== 'publish-5') requireValue(current?.group === input.group, 'Selected group is not current on this channel/runtime/platform');
  let recovery = null;
  let args;
  const common = ['--non-interactive', '--json'];
  switch (input.operation) {
    case 'publish-5':
      requireValue(!active(current), 'Finish or revert the active rollout before publishing');
      args = ['update', '--channel', input.channel, '--environment', input.channel, '--platform', input.platform,
        '--rollout-percentage', '5', '--message', `Mobile ${input.sha}`, ...common];
      break;
    case 'advance-25':
    case 'advance-100': {
      const target = input.operation === 'advance-25' ? 25 : 100;
      requireValue(!current.embedded && current.percentage === (target === 25 ? 5 : 25), 'Rollout must follow 5 -> 25 -> 100');
      args = ['update:edit', current.group, '--rollout-percentage', String(target), ...common];
      break;
    }
    case 'revert-current':
      requireValue(active(current) && !current.embedded, 'No active update rollout to revert');
      if (current.control) {
        recovery = inspectGroup(state.groups?.[current.control.group], current.control, input, runtime, branchId);
        requireValue(!active(recovery), 'Control update is itself an active rollout');
      }
      args = ['update:revert-update-rollout', '--group', current.group, '--message', `Revert ${current.group}`, ...common];
      break;
    case 'rollback-previous':
      requireValue(!active(current), 'Use revert-current while a rollout is active');
      requireValue(previous?.group === input.previousGroup, 'Selected recovery is not the immediate compatible previous update');
      recovery = inspectGroup(state.groups?.[previous.group], previous, input, runtime, branchId);
      requireValue(!recovery.embedded && !active(recovery), 'Use embedded recovery or a completed previous update');
      args = ['update:republish', '--group', recovery.group, '--destination-channel', input.channel,
        '--platform', input.platform, '--rollout-percentage', '100', '--message', `Restore ${recovery.group}`, ...common];
      break;
    case 'rollback-embedded':
      requireValue(!active(current), 'Use revert-current while a rollout is active');
      args = ['update:roll-back-to-embedded', '--channel', input.channel, '--runtime-version', runtime,
        '--platform', input.platform, '--message', `Restore embedded ${runtime}`, ...common];
      break;
  }
  return { ...base, runtime, recovery, args };
}

export function verifyPostUpdate(input, plan, state) {
  const after = inspectSnapshot(state.snapshot, input, plan.runtime);
  requireValue(after.channelId === plan.channelId && after.branchId === plan.branchId && after.current, 'Channel mapping changed or update is absent after execution');
  const record = inspectGroup(state.groups?.[after.current.group], after.current, input, plan.runtime, plan.branchId);
  requireValue(JSON.stringify(record) === JSON.stringify(after.current), 'Post-update metadata changed');
  if (input.operation.startsWith('advance-')) {
    const target = input.operation === 'advance-25' ? 25 : 100;
    requireValue(record.group === input.group && (record.percentage === target || (target === 100 && record.percentage === null)) && record.manifestHash === plan.current.manifestHash, 'Rollout percentage/content not verified');
  } else {
    requireValue(record.group !== plan.current?.group, 'No new update observed');
    if (input.operation === 'publish-5') {
      requireValue(record.percentage === 5 && !record.embedded && record.sha === input.sha, 'Published source/rollout not verified');
      requireValue(plan.current ? record.control?.id === plan.current.id && record.control?.group === plan.current.group : record.control === null, 'Published rollout control not verified');
    } else {
      requireValue(!active(record), 'Recovery left an active rollout');
      const embedded = input.operation === 'rollback-embedded' || !plan.recovery || plan.recovery.embedded;
      requireValue(record.embedded === embedded, 'Recovery target not verified');
      if (!embedded) requireValue(record.sha === plan.recovery.sha && record.manifestHash === plan.recovery.manifestHash, 'Recovery content differs from the verified previous update');
    }
  }
  return record;
}
