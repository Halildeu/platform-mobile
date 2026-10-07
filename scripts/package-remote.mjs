import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { open, rename, rm } from 'node:fs/promises';
import { readQuery } from './update-remote.mjs';
import { UUID, requireValue } from './release-common.mjs';

export const buildQuery = `query MobilePackageBuild($id: ID!) { builds { byId(buildId: $id) {
  id status platform app { id } appIdentifier gitCommitHash buildProfile distribution
  updateChannel { name } isForIosSimulator appVersion appBuildVersion
  runtime { version } fingerprint { hash } error { errorCode }
  artifacts { applicationArchiveUrl } submissions { id status }
} } }`;
export const submissionQuery = `query MobilePackageSubmission($id: ID!) { submissions { byId(submissionId: $id) {
  id status platform app { id } submittedBuild { id } error { errorCode }
  androidConfig { track releaseStatus rollout } iosConfig { ascAppIdentifier }
} } }`;
export async function readBuild(id, query = readQuery) {
  requireValue(UUID.test(id ?? ''), 'Invalid build read');
  return (await query(buildQuery, { id })).builds?.byId;
}
export async function readSubmission(id, query = readQuery) {
  requireValue(UUID.test(id ?? ''), 'Invalid submission read');
  return (await query(submissionQuery, { id })).submissions?.byId;
}

export function archiveUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid EAS archive URL'); }
  const host = url.hostname;
  const allowed = host === 'expo.dev' || host.endsWith('.expo.dev') || host === 'storage.googleapis.com' || host === 'production.eas-builds-expo.s3.amazonaws.com';
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.port && allowed, 'Unapproved EAS archive origin');
  return url;
}
export async function downloadArchive(value, destination, { fetcher = fetch, maxBytes = 1024 * 1024 * 1024, timeoutMs = 300000 } = {}) {
  const partial = `${destination}.partial`;
  let file, response;
  try {
    let url = archiveUrl(value);
    const signal = globalThis.AbortSignal.timeout(timeoutMs);
    for (let redirect = 0; redirect <= 4; redirect++) {
      response = await fetcher(url, { redirect: 'manual', signal }); // Never forward EXPO_TOKEN to an archive host.
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      requireValue(redirect < 4, 'Archive redirect limit exceeded');
      const location = response.headers.get('location');
      requireValue(location, 'Archive redirect location is missing');
      url = archiveUrl(new URL(location, url));
    }
    requireValue(response?.status === 200 && response.body, 'Archive download failed');
    const length = response.headers.get('content-length');
    requireValue(length === null || (/^[0-9]+$/.test(length) && Number(length) <= maxBytes), 'Archive length exceeds limit');
    file = await open(partial, 'wx', 0o600);
    const digest = createHash('sha256'); let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      requireValue(bytes <= maxBytes, 'Archive exceeded byte limit');
      digest.update(chunk);
      await file.writeFile(chunk);
    }
    requireValue(bytes > 0 && (length === null || bytes === Number(length)), 'Archive was empty or truncated');
    await file.sync(); await file.close(); file = null;
    await rename(partial, destination);
    return { sha256: digest.digest('hex'), bytes };
  } catch {
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    if (file) { await file.close().catch(() => {}); await rm(partial, { force: true }).catch(() => {}); }
    throw new Error('Archive verification failed; URLs and raw response withheld');
  }
}

// Poll an existing identity only. A timeout never dispatches another operation.
export async function waitForPackage(read, inspect, { now = Date.now, sleep = setTimeout, timeoutMs = 45 * 60 * 1000, intervalMs = 15000 } = {}) {
  const deadline = now() + timeoutMs;
  while (true) {
    const value = await read(); inspect(value, false);
    if (value.status === 'FINISHED') { inspect(value, true); return value; }
    requireValue(now() < deadline, 'Package still pending; resume read-only with the recorded ID');
    await sleep(Math.min(intervalMs, deadline - now()));
  }
}
