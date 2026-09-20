import { PROJECT_ID, UUID, FINGERPRINT, CHANNELS, requireValue } from './release-common.mjs';

// Read-only subset of eas-cli 24.7.0 UpdateQuery/BranchQuery/ChannelQuery.
// update:view JSON drops rollout controls; do not infer them from display output.
const fields = `id group createdAt platform runtime { version } branch { id name }
  isRollBackToEmbedded isGitWorkingTreeDirty gitCommitHash manifestFragment
  awaitingCodeSigningInfo codeSigningInfo { keyid sig alg }
  rolloutPercentage rolloutControlUpdate { id group }`;
export const snapshotQuery = `query MobileUpdateSnapshot($appId: String!, $name: String!, $platform: AppPlatform!, $runtime: String!) {
  app { byId(appId: $appId) { id
    updateChannelByName(name: $name) { id name isPaused branchMapping }
    updateBranchByName(name: $name) { id name
      updates(offset: 0, limit: 2, filter: { platform: $platform, runtimeVersions: [$runtime] }) { ${fields} }
    }
  } }
}`;
export const groupQuery = `query MobileUpdateGroup($groupId: ID!) { updatesByGroup(group: $groupId) { ${fields} } }`;

export async function readQuery(query, variables, { token = process.env.EXPO_TOKEN, fetcher = fetch } = {}) {
  requireValue(typeof token === 'string' && token.length > 0, 'EXPO_TOKEN is required for metadata reads');
  let response, payload;
  try {
    response = await fetcher('https://api.expo.dev/graphql', { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }), signal: globalThis.AbortSignal.timeout(60000) });
    requireValue(response.ok, 'EAS metadata HTTP failure');
    const body = await response.text();
    requireValue(body.length <= 2 * 1024 * 1024, 'EAS metadata response too large');
    payload = JSON.parse(body);
  } catch { throw new Error('EAS metadata unavailable; raw response withheld'); }
  requireValue(payload.data && (!payload.errors || (Array.isArray(payload.errors) && payload.errors.length === 0)), 'EAS metadata query failed or is partial');
  return payload.data;
}
export async function readSnapshot(input, runtime, query = readQuery) {
  requireValue(CHANNELS.includes(input.channel) && ['android', 'ios'].includes(input.platform) && FINGERPRINT.test(runtime), 'Invalid snapshot scope');
  return query(snapshotQuery, { appId: PROJECT_ID, name: input.channel, platform: input.platform.toUpperCase(), runtime });
}
export async function readGroup(group, query = readQuery) {
  requireValue(UUID.test(group ?? ''), 'Invalid group read');
  return (await query(groupQuery, { groupId: group })).updatesByGroup;
}
