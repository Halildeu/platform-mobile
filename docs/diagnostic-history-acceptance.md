# Persistent mobile diagnostics acceptance

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

## Candidate verification — 2026-09-25

- Jest: 52 suites, 522 tests passed, including real SQLite reopen/pruning and
  screen remount, logout/login account isolation, stale callbacks and all startup stages.
- TypeScript and ESLint passed. Independent Codex review: AGREE after corrections.
- Android ARM64 release-mode build passed (TEST, local debug signing; not a store release).
- Expo web export with a fresh Metro cache passed. Browser inspection confirmed
  the Tanılama panel and unavailable-storage fallback; web is not native storage proof.
- No Android device was connected to ADB. Physical Android/iOS persistence,
  SQLCipher inspection, Detox/Maestro device acceptance remain open.
- Shared STT, backend and Electron were not changed. Name punctuation remains open.
