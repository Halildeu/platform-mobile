# Mobile recording lifecycle candidate — 25 September 2026

Scope: Android recording ownership, authenticated live-analysis reconnection,
credential rotation persistence and Expo preview. Builds on PR #45. No provider
configuration, backend, Electron, Teams bot, OTA or audio retention change.

## Behavior

- The Android recording notification owns the actual PCM stream. Its stop action,
  service destruction and task removal stop capture natively. Registration IDs
  prevent delayed old actions from stopping a new recording.
- Capture cannot start until its foreground notification is ready and microphone,
  application notification and recording-channel permissions are available.
- Unexpected native capture failure or a ten-second lack of PCM progress remains
  incomplete, even when previously sent audio drains successfully. Silence still
  produces PCM; there is no total recording duration limit.
- Live analysis resolves a current access token on every reconnect. A late refresh
  cannot restart a stopped subscription or restore a replaced account.
- A successfully rotated refresh token survives a temporary secure-storage write
  failure in memory; persistence is retried before the next use.
- Expo preview registers the SQLite WASM asset and skips unavailable native PCM
  listeners/journal cleanup. Web preview is not native microphone acceptance.

## Evidence

- TypeScript and ESLint: passed.
- Jest: 50 suites, 508 tests passed.
- Workflow/package scripts: 72 tests passed (iOS plugin, Detox configuration,
  FCM configuration, OTA planning/remote/release and package checks).
- Android registry JUnit: 5 tests passed; release ARM64 APK compiled successfully.
- Expo web export passed. Browser verification: transcript demo is one paragraph;
  live-test opens and its Actions tab renders at 360×800 without horizontal
  overflow. Web secure-session storage is unavailable, as expected in this native
  app preview; no real login, microphone or server analysis is claimed here.
- Independent mobile acceptance and lifecycle code reviews: AGREE. Latest review
  after native compile and preview fixes found no new P1/P2 issue.

GitHub Actions run 35877610871 attempt 2 was retried on 25 September. Check
107981232571 states that the job did not start because account payments failed or
the spending limit must be increased. Local success does not make CI green.
Project #4 item updates were attempted but the authenticated token lacks the
required project-write scope; existing issue links remain the tracking source.

The Linux-only Maestro process harness cannot be executed as-is in Windows;
neither native Detox/Maestro nor physical Android/iOS acceptance is claimed by
these local checks. No attached ADB device or local emulator image was available.

## Remaining acceptance

1. On the new Android APK: opt into background recording, lock the screen, speak,
   unlock and verify the recorded span. Stop from the persistent notification;
   verify microphone indicator stops and normal result closure is confirmed.
2. Disable the recording notification channel and verify a clear start refusal.
   Remove the app from Recents during an approved test; verify microphone stops
   and any incomplete result is not presented as fully captured.
3. Brief network loss/recovery, long-session token refresh, logout/account switch
   and result reopening on the same candidate. Check live decision/action updates
   before stopping, including corrections and cancellations.
4. Physical iOS, Firebase corporate/configuration and real push delivery,
   signing/store/OTA acceptance and approved final designs remain separate gates.
5. Name-after-pause owner loss and transcription date errors remain open. The
   user deferred the name/pause investigation; this candidate does not claim to
   solve either model/provider output problem.

Related: #1, #3, #4, #6, #7, #8. No issue is closed by this report.
