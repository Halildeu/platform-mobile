# Native mobile notifications — implementation and TEST activation

Backend counterpart: platform-backend#1174. Tracks platform-mobile#9; no closure claim.

Adds explicit notification permission rationale, native Expo FCM/APNs token registration, refresh on foreground/token change, and owner-bound logout cleanup. Enrollment saves a token-free SecureStore cancellation receipt before network access. Lost responses remain removable by installation ID. Rotations and logout are serialized; a delayed permission dialog cannot enroll after logout.

Disabled by default. After backend deployment/configuration, set extra.nativePush.enabled=true, environment=TEST and orgId to the authorized TEST organization. Android requires matching Firebase package configuration; iOS requires APNs signing capability and provider environment. No credential belongs in this file or APK.

Offline logout still clears the login session but reports incomplete server cleanup; the receipt prevents another account from taking it over. Reauthenticate as the original account and disable notifications to complete cleanup. This does not guarantee remote revocation while offline.

Validation: full 235-test suite passed; three additional native permission/registration/logout-dialog tests passed. Typecheck/lint and Android/iOS exports passed. Web export failed at expo-sqlite's missing wa-sqlite.wasm; no all-platform success claimed. Provider and physical-device delivery/tap/account-switch tests remain unperformed. Combined-source review is pending.

Acceptance: authorized TEST account enables notifications; submit an authorized meeting event; observe background and foreground phone delivery; tap opens the matching meeting; rotate token; log out and verify old-account delivery stops; switch accounts; test offline cleanup; repeat on iOS. Retest microphone/result/reopen regression in installed package. Do not treat export or registration success as delivery acceptance.
