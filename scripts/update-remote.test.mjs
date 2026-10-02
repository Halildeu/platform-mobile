import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readQuery, readSnapshot, readGroup, snapshotQuery, groupQuery } from './update-remote.mjs';
import { input, runtime, id } from './update-fixtures.mjs';
import { PROJECT_ID } from './release-common.mjs';

test('metadata adapter sends only fixed read queries to the fixed authenticated HTTPS endpoint', async () => {
  const data = await readQuery(snapshotQuery, {}, { token: 'test-only', fetcher: async (url, options) => {
    assert.equal(url, 'https://api.expo.dev/graphql'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    assert.ok(!JSON.parse(options.body).query.includes('mutation'));
    return { ok: true, text: async () => JSON.stringify({ data: { marker: true } }) };
  } });
  assert.equal(data.marker, true);
});
test('partial GraphQL data, invalid JSON, HTTP/network failures and missing data fail closed without response content', async () => {
  for (const [ok, body] of [[false, 'credential'], [true, 'credential'], [true, JSON.stringify({ data: { app: {} }, errors: [{ message: 'credential' }] })],
    [true, JSON.stringify({ errors: [] })], [true, JSON.stringify({ data: {}, errors: 'credential' })]]) {
    await assert.rejects(readQuery(snapshotQuery, {}, { token: 'test-only', fetcher: async () => ({ ok, text: async () => body }) }), error => !error.message.includes('credential'));
  }
  await assert.rejects(readQuery(groupQuery, {}, { token: 'test-only', fetcher: async () => { throw new Error('credential'); } }), /raw response withheld/);
});
test('snapshot query scopes latest two by project, selected channel, platform and installed runtime', async () => {
  await readSnapshot(input, runtime, async (query, variables) => {
    assert.equal(query, snapshotQuery);
    assert.deepEqual(variables, { appId: PROJECT_ID, name: 'preview', platform: 'ANDROID', runtime });
    assert.match(query, /limit: 2/); assert.match(query, /runtimeVersions: \[\$runtime\]/);
    assert.match(query, /rolloutControlUpdate/); return {};
  });
  await readGroup(id(10), async (query, variables) => { assert.equal(query, groupQuery); assert.deepEqual(variables, { groupId: id(10) }); return { updatesByGroup: [] }; });
});
