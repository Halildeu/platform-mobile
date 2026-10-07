#!/usr/bin/env bash
set -euo pipefail
mkdir -p artifacts/detox
test "${GITHUB_ACTIONS:-}" = true
test "${MOBILE_DETOX_E2E:-}" = 1
test "$(adb -s emulator-5554 shell getprop ro.kernel.qemu | tr -d '\r')" = 1
node scripts/detox-artifacts.cjs verify android "$(git rev-parse HEAD)"
apk=android/app/build/outputs/apk/release/app-release.apk
test_apk=android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk
apkanalyzer manifest application-id "$apk" | tee artifacts/detox/app-id.txt
apkanalyzer manifest application-id "$test_apk" | tee artifacts/detox/test-app-id.txt
grep -Fxq 'com.workcube.meeting' artifacts/detox/app-id.txt
grep -Fxq 'com.workcube.meeting.test' artifacts/detox/test-app-id.txt
apkanalyzer manifest print "$test_apk" > artifacts/detox/test-manifest.xml
grep -q 'androidx.test.runner.AndroidJUnitRunner' artifacts/detox/test-manifest.xml
grep -q 'android:targetPackage="com.workcube.meeting"' artifacts/detox/test-manifest.xml
adb -s emulator-5554 install -r "$apk" > artifacts/detox/app-install.txt
adb -s emulator-5554 install -r "$test_apk" > artifacts/detox/test-install.txt
adb -s emulator-5554 shell pm list instrumentation > artifacts/detox/instrumentation.txt
grep -Fxq 'instrumentation:com.workcube.meeting.test/androidx.test.runner.AndroidJUnitRunner (target=com.workcube.meeting)' artifacts/detox/instrumentation.txt
# Detox reverses its chosen server port over ADB; the test policy permits loopback only.
trap 'adb -s emulator-5554 logcat -d -t 3000 > artifacts/detox/logcat.txt 2>&1 || true' EXIT
npx detox test --configuration android.ci.release --record-logs all --take-screenshots all --artifacts-location artifacts/detox/ui 2>&1 | tee artifacts/detox/detox.log
node scripts/detox-artifacts.cjs results
