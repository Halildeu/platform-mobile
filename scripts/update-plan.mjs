import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function updatePlan({ operation, channel, group, sha }, config) {
  if (!['development', 'preview', 'production'].includes(channel)) throw new Error('Invalid channel');
  if (config.extra?.eas?.projectId !== '3597d06c-21ec-4908-b453-e72f219d5758') throw new Error('Unexpected Expo project');
  if (config.updates?.enabled !== true || config.runtimeVersion?.policy !== 'appVersion') throw new Error('OTA is not enabled and validated for this build');
  if (config.updates?.url !== 'https://u.expo.dev/3597d06c-21ec-4908-b453-e72f219d5758') throw new Error('Unexpected update server');
  if (operation === 'publish-5') {
    if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('Expected a source commit');
    return ['update', '--channel', channel, '--environment', channel, '--rollout-percentage', '5', '--message', `Mobile ${sha}`, '--non-interactive'];
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(group ?? '')) throw new Error('Expected update group UUID');
  if (operation === 'advance-25' || operation === 'advance-100') {
    return ['update:edit', group, '--rollout-percentage', operation === 'advance-25' ? '25' : '100', '--non-interactive'];
  }
  if (operation === 'rollback-previous') return ['update:republish', '--group', group, '--destination-channel', channel, '--rollout-percentage', '100', '--non-interactive'];
  throw new Error('Invalid operation');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(readFileSync('app.json', 'utf8')).expo;
  const args = updatePlan({ operation: process.env.UPDATE_OPERATION, channel: process.env.UPDATE_CHANNEL,
    group: process.env.UPDATE_GROUP, sha: process.env.GITHUB_SHA }, config);
  if (process.argv.includes('--execute')) {
    // CI only: no shell interpolation; execution is never the default.
    if (process.platform === 'win32' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Execute from the release workflow');
    const result = spawnSync('eas', args, { stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } else console.log(JSON.stringify(args));
}
