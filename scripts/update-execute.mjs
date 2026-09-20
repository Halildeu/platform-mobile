import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { command, jsonCommand, PROJECT_ID, EAS_VERSION, requireValue, resolvedConfig, resolvedRuntime, validateOtaBuild, verifyCli } from './release-common.mjs';
import { inspectSnapshot, updatePlan, validateInput, verifyPostUpdate } from './update-plan.mjs';
import { readGroup, readSnapshot } from './update-remote.mjs';

export async function collectState(input, build, localRuntime, deps = { readSnapshot, readGroup }) {
  const runtime = validateOtaBuild(build, input);
  const snapshot = await deps.readSnapshot(input, runtime);
  const base = inspectSnapshot(snapshot, input, runtime);
  const groups = {};
  const needed = new Set([base.current?.group]);
  if (input.operation === 'rollback-previous') needed.add(base.previous?.group);
  if (input.operation === 'revert-current') needed.add(base.current?.control?.group);
  for (const group of needed) if (group) groups[group] = await deps.readGroup(group);
  return { build, localRuntime, snapshot, groups };
}

// Execute at most one mutation. Persist uncertainty BEFORE invoking it: a CLI
// timeout/failure can still mean that the server accepted part or all of it.
export async function runUpdate(input, config, deps, execute = false) {
  const before = await deps.read();
  const plan = updatePlan(input, config, before);
  const receipt = { schemaVersion: 1, projectId: PROJECT_ID, cliVersion: EAS_VERSION,
    operation: input.operation, channel: input.channel, platform: input.platform,
    buildId: input.buildId, sourceCommit: input.sha, runtime: plan.runtime,
    channelId: plan.channelId, branchId: plan.branchId, current: plan.current,
    previous: plan.previous, recovery: plan.recovery, phase: 'prepared', at: new Date().toISOString() };
  await deps.record(receipt);
  if (!execute) return receipt;
  const again = updatePlan(input, config, await deps.read());
  requireValue(JSON.stringify(again) === JSON.stringify(plan), 'Remote state changed before execution; no mutation sent');
  await deps.record({ ...receipt, phase: 'mutation-outcome-unknown' });
  try {
    await deps.mutate(plan.args);
    const result = verifyPostUpdate(input, plan, await deps.read());
    const verified = { ...receipt, phase: 'verified', result, at: new Date().toISOString() };
    await deps.record(verified);
    return verified;
  } catch {
    // Do not expose provider response or let a retry duplicate a partial mutation.
    throw new Error('Update outcome is uncertain. Inspect the receipt and EAS state; do not automatically rerun this operation.');
  }
}

async function main() {
  if (process.argv.includes('--intent')) {
    const input = { operation: process.env.UPDATE_OPERATION, channel: process.env.UPDATE_CHANNEL,
      platform: process.env.UPDATE_PLATFORM, buildId: process.env.UPDATE_BUILD_ID,
      group: process.env.UPDATE_GROUP, previousGroup: process.env.UPDATE_PREVIOUS_GROUP, sha: process.env.GITHUB_SHA };
    validateInput(input);
    writeFileSync('release-intent.json', JSON.stringify(input), { flag: 'wx', mode: 0o600 });
    return;
  }
  const execute = process.argv.includes('--execute');
  requireValue(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REF === 'refs/heads/main' && process.platform === 'linux', 'Use the main-branch release workflow');
  if (execute) requireValue(process.env.GITHUB_RUN_ATTEMPT === '1', 'Automatic workflow retries cannot repeat a release mutation');
  const input = JSON.parse(readFileSync('release-intent.json', 'utf8'));
  validateInput(input);
  requireValue(command('git', ['rev-parse', 'HEAD']) === input.sha && command('git', ['status', '--porcelain']) === '', 'Release checkout changed or is dirty');
  verifyCli();
  const config = resolvedConfig();
  const localRuntime = input.operation === 'publish-5' ? resolvedRuntime(input.platform) : null;
  mkdirSync('release-evidence', { recursive: true });
  const receiptPath = 'release-evidence/update.json';
  requireValue(!existsSync(receiptPath), 'Release receipt already exists; inspect it before another operation');
  const deps = {
    read: async () => collectState(input, jsonCommand('eas', ['build:view', input.buildId, '--json']), localRuntime),
    record: async receipt => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 }),
    mutate: async args => { command('eas', args, 20 * 60 * 1000); },
  };
  const receipt = await runUpdate(input, config, deps, execute);
  console.log(`Update ${receipt.phase}; ${input.channel}/${input.platform}; receipt: ${receiptPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
