/* global process */
/** Isolated native release packages, generated from this checkout; see docs/mobile-detox.md. */
module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/jest.config.js' },
    jest: { setupTimeout: 120000 },
  },
  apps: {
    'ios.release': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Release-iphonesimulator/WorkcubeMeeting.app',
      build: 'xcodebuild -workspace ios/WorkcubeMeeting.xcworkspace -scheme WorkcubeMeeting -configuration Release -sdk iphonesimulator -destination "generic/platform=iOS Simulator" -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO build',
    },
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
      testBinaryPath: 'android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk',
      build: 'cd android && ./gradlew :app:assembleRelease :app:assembleReleaseAndroidTest -PreactNativeArchitectures=x86_64 --no-daemon --max-workers=1',
    },
  },
  devices: {
    simulator: { type: 'ios.simulator', device: process.env.DETOX_IOS_UDID ? { id: process.env.DETOX_IOS_UDID } : { type: 'iPhone 17' } },
    emulator: { type: 'android.emulator', device: { avdName: 'Pixel_7_API_35' } },
    ciEmulator: { type: 'android.attached', device: { adbName: '^emulator-5554$' } },
  },
  configurations: {
    'ios.sim.release': { device: 'simulator', app: 'ios.release' },
    'android.emu.release': { device: 'emulator', app: 'android.release' },
    'android.ci.release': { device: 'ciEmulator', app: 'android.release' },
  },
};
