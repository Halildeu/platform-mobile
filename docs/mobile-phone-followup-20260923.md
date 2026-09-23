# 23 September phone follow-up

Acceptance remains: useful decisions and actions must appear and update while
the microphone is recording. A saved result after stopping is insufficient.

## Physical phone evidence

The user's 10:28–10:29 screenshots show the microphone active, a version 1 live
summary, and empty decision/action sections. Word-level events repeat the same
anonymous speaker label on separate rows. The screenshots do not establish
whether later live snapshots were produced, transported, accepted or rendered.

For meeting `6bda4393-b544-46e5-9a52-be825484e982`, the supplied diagnostic
report shows saved-result 404 responses from 07:30:51 through 07:31:12 UTC,
then a successful saved result with verified meeting match at
**07:36:32.719 UTC (10:36:32.719 Istanbul)**. This is a read timestamp, not the
generation timestamp or a measured duration since stop. The report contains no
live counters or stop timestamp. The original live report and recording are
not requested again.

The read-only [runtime metadata run](https://github.com/Halildeu/platform-k8s-gitops/actions/runs/35832417613)
passed. Both mTLS health checks returned HTTP 200 with successful certificate
verification; the bounded recent-error scan was empty. Pod-lifetime counters
(16 attempts, 10 successes, 6 errors) are aggregate and cannot identify the
phone's version 1 or establish a per-meeting root cause.

## Source correction

The renderer previously isolated every line with speaker attribution. Since
STT sends word-sized attributed lines, each word became a new labelled row.
Consecutive known-speaker fragments in the same audio scope now share a
paragraph and one label. Speaker changes, unknown speakers, scope changes
and bounded paragraph length remain boundaries. A short sentence end is no
longer a paragraph boundary. Original event
IDs, offsets and correction/replay state are preserved.

Live snapshot diagnostics now include version, partial/final flag, summary
length, decision/action counts and whether the microphone was active. They do
not include transcript, analysis text, names, tokens or raw audio. This change
improves evidence; it does not claim to fix the unexplained live-delivery gap.

## Validation and limits

- Transcript correction: full 50 suites / 489 tests passed; focused speaker
  tests exercise word events, revised text, removed attribution, scope changes
  and unknown-speaker boundaries.
- After the additional diagnostic change: 21 live-screen tests, typecheck and
  lint passed. The live-screen regression verifies successive snapshots before
  stop and metadata-only shared diagnostics.
- A local synthetic 360 × 640 web preview with enlarged text shows one readable
  sentence per speaker instead of one word per row. Web export passed. This is
  not native Android or iOS acceptance.
- The earlier delivered APK was `bcca59b`; a later `06dd6a6` package and the
  current `c7ec443` package were built locally. The phone's installed source
  version has not been independently established; do not infer it from reused
  screenshots.
- No new Maestro/Detox/iOS/FCM/APNs result or independent review is claimed.
  Mobile GitHub runner execution remains affected by the previously reported
  payment/spending-limit gate. No issue is closed.

Next engineering requirement: correlate live versions and counts across the
gateway and client for the same session, without recording conversation
content. Do not replace missing phone evidence with the earlier successful
synthetic server acceptance.

## Readable paragraphs and latest APK

Source `c7ec44364e01c27816094e047a6a8d9f64fb8d9a` removes the remaining
short-sentence paragraph split. The regression reproduces attributed word and
standalone-period events, with one label for the whole speaker paragraph and
unchanged source text/IDs. Long speech still splits into bounded paragraphs;
different and unknown speakers are not merged.

- Full 50 suites / 491 tests, typecheck and lint passed.
- The real renderer's `transcript-demo?scenario=word-fragments` web preview
  displayed a continuous paragraph, also with a 360-pixel viewport override.
  This does not substitute for native phone acceptance.
- ARM64 Android release build and APK v2 signature verification passed.
  File: `Workcube-23-Eylul-2026-c7ec443.apk`, 56,148,793 bytes.
  SHA256: `b3497b8a0bb588d4282864686f4fec464456c000212ed2a266f0955a3d42e452`.
  Package `com.workcube.meeting`, version 0.2.0/code 1; internal TEST signing,
  TEST endpoints, FCM and OTA disabled. Copied to the user's Downloads folder.
- GitHub unit run 35875968684 on this source did not start: the job annotation
  reports recent failed account payments or spending limit. Native CI is not
  claimed as passed, and the draft PR was not merged by bypassing checks.

The user now reports live analysis flowing. The previously supplied 10:28–10:29
screenshots remain historical and cannot disprove that new observation. No
new measured per-sentence delivery time or phone acceptance is inferred.

## Separate provider punctuation issue

The reported `Zeynep. Sunum...` / `Mehmet. Bütçe...` contains punctuation from
the provider transcript. Paragraph grouping keeps that punctuation; it does
not claim to repair recognition grammar. Blindly deleting full stops after
capitalized words would corrupt genuine sentence boundaries and names.

[Synthetic provider comparison 35876155927](https://github.com/Halildeu/platform-k8s-gitops/actions/runs/35876155927)
tested five settings: every case kept all three owner/task phrases intact and
all four genuine sentence ends. The error was not reproduced, so those results
do not justify changing the shared default. A longer-pause comparison is
tracked in GitOps PR3832; optional backend tuning is a draft in backend PR1185.
Neither is a deployed punctuation correction. Electron source and shared TEST
provider settings were not changed by this paragraph fix.
