# ADR 0019 — Preserve incomplete recording outcomes

Status: source proposal; paired backend contract required before phone distribution.

## Problem

The stop screen could send HTTP finish after an unconfirmed stream drain, including
memory-only capture. An old local receipt with endedAt was also treated as permission
to retry canonical finish. That date alone is not lossless-delivery evidence.
Each reconnected server bridge can open a new STT session, so the last bridge's
drained event cannot establish completion of all earlier audio (ADR0018).

## Decision

- Persist v2 lifecycle metadata as completion=unknown before microphone start.
  Only an active capture's uninterrupted drain, plus durable-buffer confirmation
  where configured, can persist completion=confirmed. Local microphone stop is
  recorded independently of storage/network failure. A finish retry cannot create proof.
- Legacy receipts never write a new finish. An exact owner-bound canonical GET can
  reconcile an already-ended receipt; otherwise retain it for explicit resolution.
- The pending-recording panel offers closure retry and separately confirmed closure
  as incomplete. This is not a successful audio recovery option. User-facing text
  explains that unsent local audio is removed and already received server text remains.
- Store a stable abandonment end time before the first request. First PUT canonical
  abandonment; persist its matching acknowledgement. Then POST gateway abandonment
  with a fixed idempotency key. Retry resumes the acknowledged phase. Only the explicit
  authenticated SESSION_NOT_FOUND error after canonical acknowledgement permits
  cleanup when the gateway has expired/restarted. Generic 404 or ambiguous responses
  retain the receipt and data.
- Release any native buffer handle before cleanup; keep the lease through key/file/
  journal removal and only then clear lifecycle metadata. A cleanup failure remains retryable.
- Backend terminal finish/abandon serialize on the same meeting lock, check owner and
  exact times. Incomplete closure emits no recording.finished event and cannot later
  become successful. Gateway ABANDONING blocks audio/EOF/reconnect even if cleanup fails.
- Canonical result reads include incompleteRecordingCount across the whole meeting,
  not only the selected result session. Screen, Markdown and result PDF warn when
  another recording is incomplete. Missing count from an older server remains unknown.

## Privacy and compatibility

Only bounded owner/session/timestamp/outcome metadata is added to SecureStore; no
raw audio, transcript, credentials or extra retention duration. Persistent audio
remains opt-in/default off. No server erasure contract is bypassed. V17 schema and
the new endpoints must precede this mobile release; no runtime rollout is included.

## Validation and remaining work

Regression cases cover unknown receipts, legacy read-only reconciliation, lost
canonical/gateway replies, stable retry, owner mismatch, native handle cleanup,
reconnect continuity, user confirmation and incomplete result export. Backend tests
cover terminal races/rollback, handler cancellation and multi-session count scoping.
Validation results belong to the paired PRs; local SQL fixtures do not establish
SQLCipher or real phone acceptance.

Successful cold-restart recovery still requires a server-owned persistent STT session
or durable per-chunk processing ledger. Replaying gateway-unacknowledged chunks alone
cannot prove losslessness. Issue #7 stays open until that architecture and physical
network/kill/reopen tests are completed; this proposal does not redefine its acceptance.
