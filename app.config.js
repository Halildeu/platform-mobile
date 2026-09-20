const fs = require('node:fs');
const path = require('node:path');

// Opt-in Android TEST configuration. Never accept server credentials in an APK.
module.exports = ({ config }) => {
  // Only new OTA-specific native builds opt in. Existing device builds stay off.
  if (process.env.MOBILE_OTA_ENABLED === '1') {
    config = { ...config, runtimeVersion: { policy: 'fingerprint' },
      updates: { ...config.updates, enabled: true,
        url: 'https://u.expo.dev/3597d06c-21ec-4908-b453-e72f219d5758' } };
  }
  if (process.env.MOBILE_FCM_TEST !== '1') return config;
  const file = process.env.MOBILE_FCM_CONFIG_PATH;
  const orgId = process.env.MOBILE_NATIVE_PUSH_ORG_ID;
  if (!file || !orgId || orgId.trim() !== orgId || orgId.length > 64) {
    throw new Error('Android FCM TEST requires a client config file and authorized TEST organization.');
  }
  const absolute = path.resolve(file);
  const client = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  if (client.private_key || client.type === 'service_account' ||
      client.project_info?.project_id !== 'workcube-meeting-test' ||
      client.project_info?.project_number !== '1043284856151' ||
      !client.client?.some(entry => entry.client_info?.android_client_info?.package_name === config.android?.package &&
        entry.client_info?.mobilesdk_app_id === '1:1043284856151:android:0564ed29072726c36f0212')) {
    throw new Error('Android FCM TEST client configuration does not match the approved project and app.');
  }
  return { ...config, android: { ...config.android, googleServicesFile: absolute },
    extra: { ...config.extra, nativePush: { enabled: true, environment: 'TEST', orgId, platforms: ['android'] } } };
};
