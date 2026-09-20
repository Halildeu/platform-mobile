# ADR 0018 — Reopen pending audio without claiming complete transcription

Status: source preparation; #7 recovery UI and server integrity integration remain open.
Date: 2026-09-20. Builds on ADR 0017. No default retention policy is enabled.

## Problem

Creating a new SQLite store cannot recover a prior recording: doing so can replace
missing tables or loss counters with empty defaults. Likewise, a new live WebSocket
can transmit pending frames but cannot prove that audio already acknowledged by an
earlier connection became durable text.

Source inspected: canonical `platform-backend` commit `5e6b0aed` in
`audio-gateway-service/docs/contract-v1.md` (live reconnect semantics),
`LiveSttWebSocketProxyHandler` and `InMemoryAudioSessionRegistry`. Each live bridge
creates a new Speechmatics protocol adapter. Session-level relay sequence survives
a socket disconnect and suppresses duplicates, but accepted audio is explicitly an
at-most-once upstream transport boundary. An ACK is admission, not final transcript
persistence. The registry is in-memory and cannot promise survival of gateway restart.
These are source observations, not a measurement of current TEST runtime.

## Decision

- `reopenEncryptedChunkBuffer` requires the exact owner/session identity and a
  validated `ready` journal record. It holds the original runtime lease until the
  native handle successfully closes. It never creates a new key or a replacement
  database, queue table or loss-counter row.
- Original retention is read from the encrypted journal. Reopening does not reset
  enqueue timestamps. Missing files/keys are marked lost. Invalid schema/data is
  unreadable, not an empty successful recording. Cleanup uses the same existing-only
  store mode so that a launch sweep cannot hide damage before recovery.
- Pending frames retain sequence, PCM bytes and capture/enqueue times. New capture
  is disabled on a recovered buffer. Replay does not require a new-sequence watermark
  because it cannot append microphone frames. Continuing capture would need a separate
  persisted sequence design, not a sequence reset to zero.
- `replayPendingAudio` performs one bounded transport attempt using the existing
  foreground stream's ready, backpressure, ACK, EOF and drain checks. Explicit retry
  uses a fresh authenticated socket and the same remaining queue. Cancellation and
  failure close transport without deleting unacknowledged rows.
- Its result is `gateway-drained` with `historyComplete: false`. It does not expose
  canonical HTTP finish or mark the journal drained. Even an empty recovered queue
  remains `ready` and blocks normal finish: previous STT completeness is unresolved.
- This transport helper is not wired into a customer recovery button yet. Surfacing
  it as a successful meeting recovery would be false. No session is automatically
  abandoned, finalized or recreated.

## Alternatives and required continuation

Blind replay of gateway-ACKed audio on a new session risks duplication and lost
attribution. Sending realtime audio to the existing REST chunk endpoint is not a
drop-in fix either: `DirectSttForwardingDispatcher` delegates realtime chunks without
performing its non-realtime transcription path.

The full requirement needs a durable server ingestion/processing receipt (or a
server-owned live session that survives client reconnect), stable transcript ranges,
and an explicit incomplete/abandon outcome. A durable ingestion path is a substantive
alternative to merely reconnecting the same live proxy. It must retain Speechmatics
and respect the separate retention decision. This remains required work, followed by
authenticated recovery/abandon UI and a synchronized backend/mobile contract change.

## Validation and limits

Tests use actual SQLite transactions/files for close/reopen and malformed data, with
synthetic SQLCipher capability and SecureStore adapters. They verify foreign identity,
missing storage, loss/TTL, original frames, late and duplicate receipts, bounded
timeout/cancel, exact-handle close retry, and the continued canonical-finish block
after transport drain. They do not prove device encryption, keychain behavior,
provider reconnect completeness or phone acceptance.
