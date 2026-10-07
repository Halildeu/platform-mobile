# Native Detox smoke

The `Detox native Android and iOS` workflow creates disposable native projects
from the checked-out source. Android builds both the Release application and
instrumentation APK before booting a separate AOSP emulator runner. iOS builds
with Xcode27, records an installed simulator UDID/runtime and launches there.

Both platforms must complete the real Detox native handshake and display
`app-root` and `app-home-title`. The success screenshot, JUnit and package/source
fingerprints are required. Compile errors, setup errors, unavailable runtimes,
failed assertions and missing evidence fail their jobs. The existing Maestro
flows remain separate. The workflow has no signing, submit, merge or deployment.

Android native generation requires `MOBILE_DETOX_E2E=1`; it uses a separate
test-only network policy and exact installed Detox dependency. Always use a
fresh isolated checkout/native directory. Never install these instrumented
packages on a user's phone or reuse the generated directory for store builds.
Normal prebuilds with the flag absent or `0` do not register the plugin.

For local simulator use, prebuild the platform and install iOS pods, then use
`npx detox build --configuration ios.sim.release` / `android.emu.release` and
the corresponding `npm run test:e2e:ios` / `test:e2e:android` commands. Android
expects an AVD named `Pixel_7_API_35`; CI binds only `emulator-5554`. Set
`DETOX_IOS_UDID` to select a specific installed simulator. CI uses no physical
device or authenticated account.

See [ADR0016](adr/0016-isolated-detox-native-tests.md) for the RN/Detox
compatibility question and evidence limits. A green smoke cannot close all #1
coverage or replace actual recording, notification and device acceptance.
