# ADR0024 — Opt-in detailed evidence for short synthetic mobile tests

Status: withdrawn from application UI/capture on 2026-09-25 at user request.
The description below is historical. No new detailed capture is initiated.
Compatibility helpers and the existing encrypted-record expiry cleanup remain.
Native device acceptance was not completed. This was not a punctuation fix.
Extends ADR0023 without changing the ordinary metadata report.

## Problem and evidence boundary

Counting punctuation cannot show whether `Zeynep.` arrived as a separate gateway
final or whether an owner was present in the analysis returned to the phone.
For a controlled synthetic test the user can explicitly enable one-run capture.
The application records validated gateway text fields (including separate
partial confirmed/tentative), final source sample ranges when supplied, anonymous
speaker spans, and validated analysis output. It never labels these as raw
Speechmatics events, the model's input, or grounding rejection reasons. Those
server-only facts still require server correlation by meeting/session/run.

PCM16 arriving at the app is measured in 1600-sample / 100ms windows, carried
across native buffer boundaries, with RMS, peak, exact-zero count and maximum
within-window zero run. Windows are batched for one-second writes. Callback
arrival gaps and transport queue counters are included. PCM itself is not stored.
Oversized/unsupported buffers produce explicit measurement-gap events. Valid
skipped sample counts advance subsequent offsets; an unknown format marks the
sample origin as unreliable for the remainder of the run.
The capture sample origin is distinct from the gateway/provider sample origin;
they cannot be equated without server evidence. Zeros alone do not establish DSP
noise gating; callback gaps are not acoustic pauses. No provider parameter,
microphone source, audio transmission payload, backend or Electron change.

## Explicit control, retention and isolation

- Off by default. A choice is bound to the current account handle and meeting,
  consumed at the next recording attempt even if permissions/startup fail.
- Durable content has no implicit retention: the API refuses it without an
  explicit duration. The synthetic-test UI offers 1 or 24 hours; 24 hours is an
  engineering ceiling, not a production policy/default. Expiry is stored per run.
- Each callback checks a monotonic three-minute deadline and a 2000-event bound.
  Reaching a diagnostic limit never stops the ordinary meeting recording.
- Microphone stop closes PCM measurement; same-run text/analysis during draining
  may be collected within the original deadline. Logout/closed handles reject
  late writes. No automatic opt-in survives a restart or another recording.
- Content uses a separate table inside the account's existing SQLCipher DB,
  SecureStore key, a 5000-event / 2 MiB UTF-8 payload account cap, explicit expiry and deletion. Ordinary
  reports cannot read this table. Detailed share has a separate content warning.
- Expired rows are removed on authenticated database access; physical deletion
  while the app/account is inactive is not promised. Account cap remains eight.
- Fixed content/array bounds are revalidated on read and write; shortened payloads
  carry `truncated=true`. Reports identify missing server-side evidence explicitly.
  SQL prunes oldest payloads before loading them into JavaScript. Export retains
  newest contiguous evidence within 524288 characters and states omitted counts.
  Delayed native share/erase confirmations are fenced by mounted account/meeting.
- No automatic upload or retention of raw audio, credentials or arbitrary event
  headers/errors. User controls export and erasure for the selected meeting.

The user's request authorizes building a diagnostic capability. It does not
automatically enable it for business meetings or approve a production retention
policy. Existing consent and encryption boundaries stay in force. Provider-distinct
policy consultation from canonical ADR0030 remains a rollout review item; this
local engineering ADR does not replace that policy.

## Validation

Known PCM vectors across split callbacks; partial/final name boundary and
ownerless output; default-off and one-use UI consent; deadline/closed callback
guards; content export separate from ordinary diagnostics; parameter-required
retention, SQLite reopen, account separation, expiry and quota tests. Physical
Android/iOS and cross-device source correlation remain acceptance work.
