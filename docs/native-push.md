# Native mobile notifications — implementation and TEST activation

Backend counterpart: platform-backend#1174. Tracks platform-mobile#9; no closure claim.

Adds explicit notification permission rationale, native Expo FCM/APNs token registration, refresh on foreground/token change, and owner-bound logout cleanup. Enrollment saves a token-free SecureStore cancellation receipt before network access. Lost responses remain removable by installation ID. Rotations and logout are serialized; a delayed permission dialog cannot enroll after logout.

Token-change callbacks consume the supplied `DevicePushToken` directly. They
never call `getDevicePushTokenAsync`, which can emit another token-change event
in Expo. Foreground refresh may request a token; both paths validate platform,
current owner, configuration and enabled receipt. Generation/session/scope are
checked again inside the ordered operation after storage reads. A permission
response from before logout cannot rotate or disable a later enrollment.
Foreground display policy and its local deadline are documented in
[native-notifications.md](native-notifications.md).

Disabled by default. After backend deployment/configuration, set extra.nativePush.enabled=true, environment=TEST and orgId to the authorized TEST organization. Android requires matching Firebase package configuration; iOS requires APNs signing capability and provider environment. No credential belongs in this file or APK.

## Isolated Android FCM TEST build

The user-authorized personal Firebase project `workcube-meeting-test` is isolated
from the existing TEAS project. `app.config.js` opts in only with
`MOBILE_FCM_TEST=1`, `MOBILE_FCM_CONFIG_PATH` pointing to its downloaded Android
client JSON, and `MOBILE_NATIVE_PUSH_ORG_ID` set to the verified TEST organization.
It validates project number, project ID, Firebase app ID and Android package;
server service-account JSON is rejected. The client config is not a sender key.
Only Android enrollment is enabled; iOS APNs remains disabled in this build.

For a device workflow, set `MOBILE_FCM_TEST_CLIENT_JSON` as a repository secret
containing only that client JSON and `MOBILE_NATIVE_PUSH_TEST_ORG_ID` as a repository
variable. Dispatch `target=device`, `fcm_test=true` only after TEST registry/server
activation is verified. Missing inputs fail the build. Ordinary builds remain
unchanged. Do not put an FCM private key in either input, repository, or APK.
No Firebase activation, provider call, runtime rollout or phone delivery is
established by a passing build. Personal TEST project use is not company
production credential approval.

Offline logout still clears the login session but reports incomplete server cleanup; the receipt prevents another account from taking it over. Reauthenticate as the original account and disable notifications to complete cleanup. This does not guarantee remote revocation while offline.

Earlier validation on the registration source: full 235-test suite plus three
native permission/registration/logout-dialog tests, typecheck/lint and
Android/iOS exports passed. Web export failed at expo-sqlite's missing
wa-sqlite.wasm; no all-platform success claimed. New token-event and foreground
regressions cover recursion, wrong scope/platform, stale permission answers,
logout, storage failure and a slow handler. Current commit/CI evidence belongs
in the accompanying source review; earlier exports do not validate new changes.
Provider and physical-device delivery/tap/account-switch tests remain required.

Acceptance: authorized TEST account enables notifications; submit an authorized meeting event; observe background and foreground phone delivery; tap opens the matching meeting; rotate token; log out and verify old-account delivery stops; switch accounts; test offline cleanup; repeat on iOS. Retest microphone/result/reopen regression in installed package. Do not treat export or registration success as delivery acceptance.
