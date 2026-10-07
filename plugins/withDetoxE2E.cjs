const { withAppBuildGradle, withProjectBuildGradle, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');
const marker = '// Workcube isolated Detox E2E v1';
function appendOnce(source, block) {
  source = source.replace(/\r\n/g, '\n');
  if (source.includes(marker)) {
    if (!source.endsWith(block)) throw new Error('Unrecognized Detox native patch; regenerate an isolated native project.');
    return source;
  }
  return source.trimEnd() + '\n\n' + block;
}
function appGradle(source, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Detox requires an exact release version');
  return appendOnce(source, `${marker}
android {
    testBuildType 'release'
    defaultConfig { testInstrumentationRunner 'androidx.test.runner.AndroidJUnitRunner' }
    buildTypes.release.proguardFile "\u0024{rootProject.projectDir}/../node_modules/detox/android/detox/proguard-rules-app.pro"
}
dependencies { androidTestImplementation('com.wix:detox:${version}') }
`);
}
function projectGradle(source) {
  return appendOnce(source, `${marker}
allprojects { repositories { maven { url("\u0024rootDir/../node_modules/detox/Detox-android") } } }
`);
}
const network = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">10.0.2.2</domain>
  </domain-config>
</network-security-config>
`;
function javaTest(packageName) {
  if (packageName !== 'com.workcube.meeting') throw new Error('Unreviewed Detox app package');
  return `package ${packageName};
import com.wix.detox.Detox;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.LargeTest;
import androidx.test.rule.ActivityTestRule;
@RunWith(AndroidJUnit4.class)
@LargeTest
public class DetoxTest {
    @Rule public ActivityTestRule<MainActivity> activity = new ActivityTestRule<>(MainActivity.class, false, false);
    @Test public void runDetoxTests() { Detox.runTests(activity); }
}
`;
}
function writeGenerated(file, value) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== value) {
    throw new Error('Refusing to replace an unknown Detox test file: ' + path.basename(file));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
}
module.exports = config => {
  if (process.env.MOBILE_DETOX_E2E !== '1') return config;
  if (process.env.MOBILE_FCM_TEST === '1' || process.env.MOBILE_OTA_ENABLED === '1') {
    throw new Error('Detox packages cannot enable FCM or OTA');
  }
  const version = require('detox/package.json').version;
  const java = javaTest(config.android?.package);
  config = withAppBuildGradle(config, mod => {
    if (mod.modResults.language !== 'groovy') throw new Error('Detox expects the reviewed Expo Groovy template');
    mod.modResults.contents = appGradle(mod.modResults.contents, version); return mod;
  });
  config = withProjectBuildGradle(config, mod => {
    if (mod.modResults.language !== 'groovy') throw new Error('Detox expects the reviewed Expo Groovy template');
    mod.modResults.contents = projectGradle(mod.modResults.contents); return mod;
  });
  config = withAndroidManifest(config, mod => {
    const app = mod.modResults.manifest.application?.[0];
    if (!app?.$) throw new Error('Missing Android application manifest');
    const existing = app.$['android:networkSecurityConfig'];
    if (existing && existing !== '@xml/detox_network_security_config') throw new Error('Existing network policy requires explicit Detox review');
    app.$['android:networkSecurityConfig'] = '@xml/detox_network_security_config'; return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const root = mod.modRequest.platformProjectRoot;
    writeGenerated(path.join(root, 'app/src/androidTest/java/com/workcube/meeting/DetoxTest.java'), java);
    writeGenerated(path.join(root, 'app/src/main/res/xml/detox_network_security_config.xml'), network);
    return mod;
  }]);
};
Object.assign(module.exports, { appGradle, projectGradle, javaTest, network });
