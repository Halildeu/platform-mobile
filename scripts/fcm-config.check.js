const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const configure = require('../app.config');

test('FCM build configuration rejects mismatched credentials and keeps other builds unchanged', () => {
  const saved = { ...process.env };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-fcm-test-'));
  try {
    const config = { android: { package: 'com.workcube.meeting' }, extra: { eas: { projectId: 'preserved' } } };
    delete process.env.MOBILE_FCM_TEST;
    assert.equal(configure({ config }), config);
    process.env.MOBILE_FCM_TEST = '1';
    delete process.env.MOBILE_NATIVE_PUSH_ORG_ID;
    assert.throws(() => configure({ config }), /requires/);
    process.env.MOBILE_NATIVE_PUSH_ORG_ID = 'authorized-test-org';
    process.env.MOBILE_FCM_CONFIG_PATH = path.join(dir, 'google-services.json');
    const valid = { project_info: { project_id: 'workcube-meeting-test', project_number: '1043284856151' },
      client: [{ client_info: { android_client_info: { package_name: 'com.workcube.meeting' },
        mobilesdk_app_id: '1:1043284856151:android:0564ed29072726c36f0212' } }] };
    const write = value => fs.writeFileSync(process.env.MOBILE_FCM_CONFIG_PATH, JSON.stringify(value));
    write({ ...valid, private_key: 'synthetic-not-a-real-key' });
    assert.throws(() => configure({ config }), /does not match/);
    write({ ...valid, project_info: { ...valid.project_info, project_id: 'other-project' } });
    assert.throws(() => configure({ config }), /does not match/);
    write(valid);
    assert.throws(() => configure({ config: { android: { package: 'other.app' } } }), /does not match/);
    const result = configure({ config });
    assert.deepEqual(result.extra.nativePush.platforms, ['android']);
    assert.equal(result.extra.nativePush.orgId, 'authorized-test-org');
    assert.deepEqual(result.extra.eas, config.extra.eas);
    assert.equal(result.android.googleServicesFile, process.env.MOBILE_FCM_CONFIG_PATH);
    assert.equal(config.extra.nativePush, undefined);
  } finally {
    for (const key of ['MOBILE_FCM_TEST', 'MOBILE_NATIVE_PUSH_ORG_ID', 'MOBILE_FCM_CONFIG_PATH']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
