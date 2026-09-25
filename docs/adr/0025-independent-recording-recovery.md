# ADR0025 — Separate new meetings from unresolved recording closure

Status: TEST candidate, 2026-09-25. Physical phone acceptance remains open.

## Observed failure

The phone screenshot shows startup blocked at the previous recording's closure.
`begin()` called `finishPending()` on the one device receipt even for a different
meeting. For completion=unknown, both Begin and closure retry threw locally,
without asking the server. The incomplete-close fallback depends on backend PR1177,
which is still a draft; its deployment was not established before phone delivery.
This is not evidence that detailed diagnostics caused the incomplete drain.

## Decision

- Provide an explicitly confirmed **Önceki kaydı koru, yeni toplantı aç** action.
  It creates/selects a different meeting. Microphone capture still requires the
  ordinary recording consent. The old receipt is not marked finished or erased.
- Store up to 20 owner-bound closure receipts in the same encrypted SecureStore
  key (maximum serialized size 32768 ASCII characters). Read old singleton/v2
  receipts directly; use a v3 envelope only when multiple records are present.
  Read-verified replacement avoids a copy/delete migration window. Corruption,
  foreign ownership or capacity prevents remote session allocation.
- Only the explicitly created separate meeting gets permission to preserve other
  meetings' unresolved receipts. Normal start reconciles every pending receipt;
  same-meeting unknown completion remains blocked. No false lossless-delivery
  proof is created. Backend consent/session/link operations are unchanged.
- Finish, abandon, result reconciliation and deletion select exact session/meeting
  identity. Resolving one entry preserves all others. Existing audio-buffer TTL,
  deletion rules and owner/session keys remain unchanged. Preserving a closure
  receipt does not imply a recoverable audio file; memory-only audio is transient.
- Persist genuine drain proof before network token refresh; refresh after storage
  and verify the same owner before server finish. Consume the in-memory stopped
  session only after the receipt write succeeds. Refresh/storage errors are retryable.
- Scope pending-panel asynchronous reads and confirmations to the selected meeting.
  Do not present a closure retry that deterministically repeats the unknown guard.
- Withdraw detailed diagnostics UI and capture hooks at the user's request. Normal
  technical history stays. Dormant detailed storage/export helpers remain for
  compatibility and their expiry cleanup remains active; no new detailed capture
  is initiated by the application. Shared STT and Electron are unchanged.

## Validation and limits

Regression tests cover legacy migration, independent start/stop, exact-target
cleanup, unknown/same-meeting protection, mixed confirmed/unknown journals,
capacity, corruption, account mismatch, refresh/storage failure, stale panel reads,
explicit confirmation and ordinary microphone consent. TEST metadata was read
through gitops run 36145178601 without runtime mutation; this is not an authenticated
abandon endpoint or physical phone acceptance test.

Old unresolved recordings still require backend lifecycle reconciliation. This
change restores a safe independent recording path; it does not claim to recover
missing audio, fix name punctuation, or complete mobile production acceptance.
