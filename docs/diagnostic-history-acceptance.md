# Persistent mobile diagnostics acceptance

Current 2026-09-25 candidate: detailed opt-in controls and capture hooks are withdrawn.
Do not follow the historical detailed-test steps below. Ordinary technical history
remains. Recording recovery is described in ADR0025: with an unknown old closure,
choose **Önceki kaydı koru, yeni toplantı aç**, confirm, then use the ordinary
**Konuşma testini başlat** consent. Verify microphone/live text and normal stop in
the separate meeting. The old closure metadata must remain available in its own
meeting; this does not certify old audio recovery or name punctuation.

Recovery candidate verification: 54 Jest suites / 554 tests, TypeScript and ESLint
passed. Independent Codex review: AGREE. Android ARM64 release build passed with
the existing TEST signer. Expo web export and `/live-test` browser navigation
passed; ordinary Tanılama renders without detailed controls. Native authentication
is unavailable in that web preview, so it is not a recording acceptance test.
No ADB device or iOS device is attached; physical acceptance and Detox/Maestro
device runs remain open. Do not downgrade to a pre-journal APK after preserving
multiple receipts: older clients cannot read the v3 envelope and will block start
without deleting it. Keep this candidate or a newer compatible APK.

Build on the current mobile lifecycle candidate (82cc55a, PR46). This change does
not reconstruct the phone's old missing diagnostics or fix punctuation itself.

1. Sign in, select a TEST meeting, record a short agreed synthetic sentence, stop.
2. Tanılama → Tanılama kaydını paylaş must include the run, session, final-text
   counters, analysis counters if received, and closing events. No spoken words
   or credentials should appear.
3. Close the app completely. Reopen and select the same meeting. Share again:
   the original run must remain, followed by any new result-read events.
4. Log out and log back into the same account. Repeat step 3. Starting another
   recording in the same meeting must append a new run ID, retaining the old run.
5. With a separate authorized account, the first account's history must not be
   shown. Returning to the first account must restore its history.
6. On another meeting, ensure no events from the first meeting appear. Erase that
   meeting's diagnostic history and verify other meetings are unaffected.
7. Exercise network recovery and background recording; shared history must show
   lifecycle/counter changes. Diagnostic write failure must be visible without
   stopping an otherwise valid audio session.
8. Repeat the durable-history flow on Android and iOS. Desktop/browser simulation
   does not count as native storage acceptance.

Retention and known limits: see ADR0023. Expired inactive-account records are
physically pruned only when that account accesses its history again. Abrupt OS
termination may prevent the final callback from reaching JavaScript.

## Opt-in detailed synthetic test

1. Before recording, select a TEST meeting and open Tanılama. The stored-history
   and detailed-report controls must appear without a storage-opening error.
   If unavailable, share the displayed safe HISTORY_* code; do not repeat a
   speech test until storage works. In meeting settings, enable `Sonraki testte ayrıntılı
   tanılama`, choosing `1 saat sakla ve aç`. Use synthetic names/tasks only.
2. Start recording. Say one fluent name/task sentence, then a second sentence
   with a pause after its name. No deliberate microphone/engine setting change.
3. While recording, inspect live actions, then stop. Tanılama → `Ayrıntılı test
   raporunu paylaş` should require the separate content-sharing confirmation.
4. Verify gateway text fragments, partial/final markers, supplied source sample
   ranges, analysis version/actions/owners, and PCM window/callback measurements.
   Do not equate callback gaps with spoken pauses or captured sample positions
   with provider positions. Server model input/rejection reasons remain absent.
5. Close/reopen and sign out/in to the same account before the chosen expiry.
   Detailed history must remain. Normal history export must contain no transcript.
   A second recording must default to detailed capture OFF.
6. Check separate account/meeting isolation, expiry on access, selected detail
   deletion, and cancellation of a pending share/erase after leaving the screen.
7. Repeat on real Android/iOS. This is diagnostic acceptance, not confirmation
   that punctuation or owner extraction is fixed.

## Candidate verification — 2026-09-25 (detailed extension)

- Jest: 54 suites, 541 tests passed, including real SQLite reopen/pruning,
  UTF-8 account quota/export bounds, synthetic PCM/sample gaps, one-run consent,
  screen remount, logout/login account isolation, stale confirmations and callbacks.
- TypeScript and ESLint passed. Independent Codex review: AGREE after corrections.
- Android ARM64 release-mode build passed (TEST, local debug signing; not a store release).
- Expo web export with a fresh Metro cache passed. Browser inspection confirmed
  the detailed panel, content warning and opening a synthetic report. Temporary
  preview fixture was removed and is excluded from the APK. This is not native
  storage or Android/iOS acceptance.
- No Android device was connected to ADB. Physical Android/iOS persistence,
  SQLCipher inspection, Detox/Maestro device acceptance remain open.
- Shared STT, backend and Electron were not changed. Name punctuation remains open.
- Broader production retention/policy review remains open (ADR0024); the detailed
  capability defaults OFF and requires an explicit short synthetic-test choice.

## Native directory correction after phone feedback

The b96f12b phone screenshot showed `history=null` and a storage opening failure,
so the detailed controls were absent. Bundled Expo SQLite returns a native path
(`/data/.../SQLite` on Android; `.standardized.path` on iOS), whereas the new
FileSystem API expects a file URI. Android's JavaFile uses `File(URI.create(...))`,
which rejects that schemeless path before SecureStore or SQLCipher is reached.

Normalize only the FileSystem directory to `file:///`; preserve the SQLite
location, key name, file name and encryption. Sidecar checks use the same Directory.
The old Node-backed FileSystem fixture incorrectly accepted raw paths. It now
rejects them, covering Android/iOS path forms and key-missing/capacity safeguards.
Native opening failures have bounded HISTORY_* stage codes in the UI and temporary
report; arbitrary native messages, paths, keys and tokens are not exported.

Independent review: AGREE; reviewer reproduced Java File(URI) rejection and ran
13 nativeHistory tests. The failure message was inspected in a synthetic browser
preview. This does not substitute for physical Android/iOS storage acceptance.

## Startup isolation after phone feedback

The fcbd646 phone screenshot shows stored-history and detailed-report controls
without the prior opening error. Its exported old meeting report contains no
detailed events. This verifies access to the report controls, not capture or
persistence after another login.

The next opt-in attempt reportedly stayed at the start button after confirmation.
The first phone exception is not available. Fault injection identified a real
matching failure mode: synchronous preparation before `start()`'s try/catch left
the active flag set, silently rejecting later attempts. Optional journal validation
and detailed capture construction could also throw outside their own boundaries.
Neither Object.hasOwn nor performance.now is proven to be the phone trigger.

Preparation is now within cleanup coverage; an ID preparation failure shows the
safe START_ID code and permits retry. Optional journal/detail failures cannot
prevent normal audio startup. Detailed setup reports success only after the first
event is stored; otherwise DETAIL_START is visible in the screen and current
report even when the journal cannot write. Successful journals retain bounded
detail_started/detail_failed events. The one-run choice is still consumed.

Verification: 54 suites / 547 tests, TypeScript and ESLint passed. Fault-injection
screen tests cover Android/iOS optional failures, normal capture, cleanup, repeat
start and safe report export; an ID failure is followed by a successful retry.
Independent review: AGREE. Real-device reproduction of the first phone exception
and successful opt-in audio capture remain open. No audio, STT, backend or Electron
setting was changed by this correction.
