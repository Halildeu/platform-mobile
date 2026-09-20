import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveUrl, downloadArchive, readBuild, readSubmission, waitForPackage } from './package-remote.mjs';
const id = '10000000-0000-4000-8000-000000000001';
const { Response } = globalThis;

test('metadata queries use exact IDs and the submittedBuild relationship', async () => {
  assert.deepEqual(await readBuild(id, async (q, vars) => { assert.ok(q.includes('byId(buildId: $id)')); assert.deepEqual(vars, { id }); return { builds: { byId: { id } } }; }), { id });
  assert.deepEqual(await readSubmission(id, async (q, vars) => { assert.ok(q.includes('submittedBuild { id }')); assert.deepEqual(vars, { id }); return { submissions: { byId: { id } } }; }), { id });
  await assert.rejects(readBuild('latest'));
});
test('archive downloads use trusted HTTPS origins without credentials on any redirect', async () => {
  for (const url of ['http://expo.dev/file', 'https://user:pass@expo.dev/file', 'https://127.0.0.1/file',
    'https://expo.dev.attacker.test/file', 'https://expo.dev:8443/file', 'file:///local', 'https://169.254.169.254/file']) assert.throws(() => archiveUrl(url));
  const directory = await mkdtemp(join(tmpdir(), 'package-archive-'));
  try {
    const bytes = Buffer.from('synthetic archive bytes'); let calls = 0;
    const result = await downloadArchive('https://expo.dev/artifacts/file', join(directory, 'app.aab'), { fetcher: async (_url, options) => {
      assert.equal(options.redirect, 'manual'); assert.equal(options.headers, undefined);
      return ++calls === 1 ? new Response(null, { status: 302, headers: { location: 'https://storage.googleapis.com/eas/file' } }) : new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
    } });
    assert.deepEqual(result, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    assert.deepEqual(await readFile(join(directory, 'app.aab')), bytes);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('oversized, truncated and failed downloads leave no incomplete archive; errors redact provider URLs', async () => {
  for (const response of [() => new Response('12345'), () => new Response('1', { headers: { 'content-length': '3' } }),
    () => new Response(null, { status: 302, headers: { location: 'http://localhost/secret' } }),
    () => { throw new Error('https://expo.dev?secret=token'); }]) {
    const directory = await mkdtemp(join(tmpdir(), 'package-failure-'));
    try {
      await assert.rejects(downloadArchive('https://expo.dev/file', join(directory, 'app.aab'), { maxBytes: 3, fetcher: response }), error => !error.message.includes('token') && !error.message.includes('http'));
      assert.deepEqual(await readdir(directory), []);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
test('polling returns a finished identity and times out without creating an operation', async () => {
  let clock = 0, reads = 0;
  const inspect = value => assert.equal(value.id, id);
  const finished = await waitForPackage(async () => ({ id, status: ++reads < 3 ? 'IN_PROGRESS' : 'FINISHED' }), inspect,
    { now: () => clock, sleep: async ms => { clock += ms; }, timeoutMs: 10, intervalMs: 2 });
  assert.equal(finished.status, 'FINISHED'); assert.equal(reads, 3);
  await assert.rejects(waitForPackage(async () => ({ id, status: 'IN_QUEUE' }), inspect,
    { now: () => clock, sleep: async ms => { clock += ms; }, timeoutMs: 5, intervalMs: 2 }), /resume read-only/);
});
