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
paragraph and one label. Speaker changes, unknown speakers, scope changes,
sentence ends and bounded paragraph length remain boundaries. Original event
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
- The installed TEST APK is still the preceding `bcca59b` source artifact;
  these source changes have not been delivered as a new phone APK.
- No new Maestro/Detox/iOS/FCM/APNs result or independent review is claimed.
  Mobile GitHub runner execution remains affected by the previously reported
  payment/spending-limit gate. No issue is closed.

Next engineering requirement: correlate live versions and counts across the
gateway and client for the same session, without recording conversation
content. Do not replace missing phone evidence with the earlier successful
synthetic server acceptance.
