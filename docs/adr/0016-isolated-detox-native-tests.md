# ADR 0016 — Isolated Detox native test packages

Status: source preparation / native compatibility proof pending.
Tracks #1. Plan-time separate Codex review: AGREE with package identity,
loopback-only policy and failure-evidence requirements. Same provider, not a
human/provider-distinct acceptance record.

## Problem and decision

The existing Detox configuration named binaries but did not generate Android
instrumentation or run either platform in CI. A successful application compile
cannot prove the native Detox handshake or UI assertions.

Use a dedicated workflow with fresh Expo prebuilds. The exact opt-in
`MOBILE_DETOX_E2E=1` adds AndroidJUnitRunner, the installed locked Detox Maven
version, a release test APK and package-correct test entry point. Normal
configuration does not include the plugin. Test mode refuses FCM/OTA opt-ins.
Generated native projects stay disposable; prebuild need not be committed and
EAS/dev-client distribution is not a prerequisite.

Detox's Android native client needs its host WebSocket. Its AndroidDriver
reverses the server port through ADB. The test-only network policy denies
cleartext generally and permits only localhost, 127.0.0.1 and emulator host
10.0.2.2 without subdomains. Never reuse this native directory for shipping.

iOS uses the verified Xcode27 Expo toolchain, an unsigned Release simulator
app and an available installed iPhone simulator selected by exact UDID/runtime.
The required applesimutils 0.9.12 is built from the upstream Homebrew formula
at `8f636f84541e08e850f455d7cffdfbd7ba305d3f`, whose source archive checksum
is fixed; the actual installed version is recorded before compiling the app.
No Apple account or physical device is needed for this smoke test.

## Proof and boundaries

Require both app and test APK identities, instrumentation target, and source
commit/hash verification before Android execution. Retain the real iOS app,
file hashes, compile result bundle, selected simulator, logs, a JUnit report and
successful home screenshot. A zero-test/skip/initialization failure cannot pass.
Keep normal synchronization and fail on errors; no retry or assertion relaxation.

Detox 20.51.4's documented guaranteed RN range ends at 0.84, while this project
uses 0.86.3. That is an unverified combination rather than evidence of failure.
The real native compile/handshake is a bounded compatibility proof. If actual
tool incompatibility is shown, evaluate Maestro iOS plus native XCTest instead
of accumulating compatibility patches; issue acceptance must acknowledge any
framework change. Physical microphone, authenticated backend, notifications,
background lifecycle and iOS parity remain separate acceptance work.

Local preparation evidence: actual isolated Android prebuild with the flag on
generated the test entry point, exact Maven dependency, runner and test-only
network policy. A separate fresh prebuild with flag `0` contained none of those
additions. Six guard/evidence tests, existing FCM/release config tests, 40 Jest
suites / 328 tests, full typecheck/lint, Bash syntax, workflow YAML and diff checks
passed. Separate source follow-up initially found missing applesimutils; the
pinned prerequisite above fixes it, and follow-up verdict is AGREE. Native
Android/iOS CI has not yet established compatibility or UI acceptance.

Primary setup: https://wix.github.io/Detox/docs/introduction/project-setup/
Locked framework: https://github.com/wix/Detox/tree/20.51.4
Simulator utility: https://github.com/wix/homebrew-brew/blob/8f636f84541e08e850f455d7cffdfbd7ba305d3f/Formula/applesimutils.rb
