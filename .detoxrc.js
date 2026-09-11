/**
 * Detox config skeleton — platform-mobile Meeting Intelligence.
 *
 * Rationale: Maestro is the primary E2E track (see docs/e2e-strategy.md);
 * Detox stays wired for the deep-integration cases that need
 * synchronised interaction (async waits, native module assertions,
 * background/foreground transitions) where Maestro's declarative model
 * is limiting.
 *
 * Building the Detox test binary in an Expo managed workflow needs a
 * one-time `expo prebuild` + `eas dev-client` step; this config points
 * at the resulting native app paths. Not wired in CI until that
 * prebuild is committed — running `npm run test:e2e:ios` locally after
 * the prebuild is the intended path today.
 *
 * References:
 *   - docs/e2e-strategy.md (framework choice + when to reach for which)
 *   - https://wix.github.io/Detox/docs/config/overview
 */

/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'e2e/jest.config.js',
    },
    jest: {
      setupTimeout: 120000,
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath:
        'ios/build/Build/Products/Debug-iphonesimulator/WorkcubeMeeting.app',
      build:
        "xcodebuild -workspace ios/WorkcubeMeeting.xcworkspace -scheme WorkcubeMeeting -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build",
    },
    'ios.release': {
      type: 'ios.app',
      binaryPath:
        'ios/build/Build/Products/Release-iphonesimulator/WorkcubeMeeting.app',
      build:
        "xcodebuild -workspace ios/WorkcubeMeeting.xcworkspace -scheme WorkcubeMeeting -configuration Release -sdk iphonesimulator -derivedDataPath ios/build",
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      build:
        'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug',
      reversePorts: [8081],
    },
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
      build:
        'cd android && ./gradlew assembleRelease assembleAndroidTest -DtestBuildType=release',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 15',
      },
    },
    emulator: {
      type: 'android.emulator',
      device: {
        avdName: 'Pixel_7_API_34',
      },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
    'ios.sim.release': {
      device: 'simulator',
      app: 'ios.release',
    },
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
    'android.emu.release': {
      device: 'emulator',
      app: 'android.release',
    },
  },
};
