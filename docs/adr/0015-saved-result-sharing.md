# Saved transcript copy and PDF file sharing (#5, #8)

Status: source implementation and automated PoC; native/device acceptance pending.

## Problem and decision

Selecting a visible transcript chunk does not copy the full saved conversation.
The existing `expo-print.printAsync` opens a print dialog; it does not implement
direct PDF-file sharing. Keep selection and printing, and add explicit whole-text
copy and PDF-file sharing for the saved transcript and saved result.

Use Expo-compatible `expo-clipboard` 57.0.2 and `expo-sharing` 57.0.21, plus the
already installed `expo-print` and legacy file-system adapter. Managed prebuild
autolinks the native modules. Incoming share extensions remain disabled in the
sharing plugin. A new native build is required; an OTA cannot add these modules.

HTML is escaped and self-contained, with no scripts or external assets. Export
uses the loaded saved content and its account epoch, never a live draft presented
as saved. Source text is not truncated: oversize input is rejected explicitly.
Limits are 5 million text characters, 8 million HTML characters and 20 MiB/PDF.

## Ownership and temporary files

The manager serializes export/cleanup. Meeting unmount, account change and logout
invalidate a pending operation. Native modules load lazily; the ownership check
runs again **after** loading and immediately before clipboard/chooser invocation.
Only this invocation marks a PDF as handed off. Cancellation before it deletes
the unshared file; cancellation after it cannot revoke a recipient's access.

An explicitly requested PDF exists unencrypted in the app's private cache so the
native share provider can open it. This is separate from the deferred raw-audio
retention decision. No transcript/audio is added to diagnostic logs. Only UUID
PDFs directly under the app's `Print/` and `meeting-exports/` cache roots are
managed; unrelated paths, traversal and arbitrary filenames are rejected.

Keep at most three recent files; reject further generation instead of evicting a
file a recipient may be reading. Sweep after ten minutes while the app is active,
on foreground return, and on next launch/logout. Cleanup failures are retried;
suspended/killed JavaScript cannot enforce an exact deletion deadline. The app
does not control copies placed in the clipboard or another app. A closed share
chooser does not prove delivery, and the UI says so.

## PoC and acceptance

The automated PoC exercises Turkish/emoji/long text, account and meeting changes,
lazy-import cancellation, concurrent requests, cache bounds, path restrictions,
failed purge retry and uncertain native handoff. The lazy-import regression first
failed on the unsafe adapter, then passed after moving the guard to the native
boundary. Source review is by another Codex agent, not a human or provider-distinct
approval.

PoC on 2026-09-20: 38 suites/296 tests, full types/lint/diff, separate Android/iOS
Hermes exports and Linux native prebuild passed. Introspection and native
autolinking resolve both new modules on both platforms. The lockfile adds only
these two modules and preserves existing pinned dependencies; npm ci dry-run
passes. No native incoming share extension is requested. The new source has not
yet passed an APK/iOS compilation or physical delivery test.

Native compilation and physical Android/iOS checks remain required:
copy an offscreen full transcript, open the PDF in a recipient app, cancel/retry,
change account/meeting during rendering, restart and reopen the saved result,
and inspect multi-page Turkish PDF layout. Unit tests cannot establish those
native behaviors or successful delivery. This slice does not change live-draft
exports, speaker editing, ERP integration or server analysis quality.
