# ADR 0017 — Durable audio discovery and loss-aware cleanup

Status: the 15-minute encrypted buffer is enabled only for preview/QA TEST
packages as approved on 2026-10-05. Production remains off. Native Android/iOS
acceptance and a server-side durable processing receipt remain required before
production activation. This ADR supplements 0001 and the KVKK boundary ADR-0030.

## Failure and decision

An encrypted per-session database alone is not a recovery mechanism: after
process death there was no discoverable list, expired empty queues forgot loss,
and lifecycle retry could finish the gateway session before pending PCM replay.

Use an encrypted SecureStore active-buffer journal (max four entries, max 2048
UTF-8 bytes), plus a separate encrypted loss/unverified-history key (max 20
hashed identities, max 2048 UTF-8 bytes, grouped by owner hash). No PCM,
transcript or token appears in either. Identity is the SHA-256 of
the existing account/tenant owner hash plus gateway session ID. Every record
and identity is validated before deriving a file/key name. Unknown, locked,
corrupt or full journals fail closed; entries are never silently evicted.

The journal writes `creating` before any key or database creation, verifies the
write, then writes `ready` after SQLCipher and the database have been verified.
A failed/ambiguous write remains discoverable. Unexpected existing files are
not overwritten. Recovery/cleanup only opens an existing file with its original
key, never creates a replacement empty database.

Within one app runtime, a lease spans registration, opening, capture, successful
close and destruction. Sweep skips active leases. A failed native close retains
the lease and retries that exact handle; no parallel open is permitted. This is
not a cross-process SQLite locking protocol; app extensions/multiple runtimes
must not share these files.

TTL/capacity removal and cumulative loss counters commit in one SQLite
transaction. Gateway ACK deletion does not increment loss. Counters survive
reopening. Loss cleanup removes audio/key but retains a `lost` tombstone;
`deleting` preserves whether cleanup follows loss or validated drain. Metadata
survives failed close, key deletion, file deletion or verification writes.

After native close and verified removal of the original file, all sidecars and
key, cleanup copies loss/unverified evidence to the separate history and reads
it back before removing the active entry. A crash at either write leaves one
or both copies; retries are idempotent and canonical finish checks both under
the same serialized journal lock. Old v1 `lost` records migrate only after the
same file/key absence checks. Unexpired nonempty PCM and leased handles remain
in their original slots. A closed empty queue without drain proof can release
its file/key but archives UNVERIFIED evidence, never a successful finish.
Explicit server-acknowledged abandonment or owner logout can forget history;
an ordinary 404 cannot. History bounds never silently evict evidence.

An empty queue alone never permits success cleanup. Only validated transport
`drained` plus no pending/lost chunks can seal the buffer and persist `drained`.
The queue checks, seal and journal transition run under the same lease and
serialized mutation. Canonical HTTP finish refuses unfinished/lost metadata,
including its retry path when starting another recording. Gateway ACK/drained
still do not prove final transcript/analysis persistence.

## Cleanup execution and alternatives

Closed-buffer expiry runs at app-root mount, foreground, before capture admission
and on a one-minute timer while the app is active. It uses the ORIGINAL retention;
restart does not extend deadlines. Active handles retain their expiry timer.
Cold replay is not implemented by this delta. Logout deletes every discoverable
buffer belonging to the signed-in account before the local session is cleared;
an unverifiable deletion makes logout report failure instead of claiming success.

Android/iOS cannot guarantee JavaScript execution at a retention deadline while
the user/OS has killed the process. This design performs physical cleanup on
the next execution, not an exact-deadline background deletion guarantee. If the
approved requirement demands no disk persistence beyond such a deadline, the
existing memory-only mode is the appropriate alternative. Configuration accepts
only the approved 900000 ms value and rejects other durations at build time.

## Verification and outstanding acceptance

The 2026-10-06 TEST startup regression exposed a native path boundary: SQLite
returns an absolute POSIX directory, while Expo File delegates to `File(URI)`
on Android and requires a `file://` URI. Audio storage now uses the existing
`databaseFileUri` conversion for file existence and every sidecar operation,
including recovery and purge. The previous permissive Node path mock concealed
the failure; tests now reject bare paths and cover Android/iOS-shaped directories,
reserved characters, reopen, cleanup and the old pre-capture `creating` intent.
This reproduces the reported startup error without treating synthetic cipher
capability as physical-device proof. A rebuilt APK still requires device acceptance.

The device report confirms stage 3 completed and microphone capture started.
The subsequent airplane/network interruption screenshot reports close 1006 and
unacknowledged chunks. The supplied history ends before the interruption,
so it cannot establish the exact retry timing or the server-side close cause.
An independent regression test reproduces a client defect: three immediately
rejected reconnects exhausted recovery in 3.5 seconds, before a 30-second outage
could end. Recovery now has a 60-second elapsed-time budget and exponential
backoff capped at 10 seconds. A ready event with pending audio does not reset
the budget; actual ACK progress does. An empty, ready connection clears it.
Stop/dispose cancel it, and explicit server policy rejection remains terminal.
The existing 2 MiB/2000-chunk capacity and TTL/loss guards can stop capture
sooner and are unchanged. No buffer-size or retention expansion is implied.

Regression coverage includes a 30-second outage with continuous PCM, ordered
replay and ACKs, fast failures, hung factories, stale late sockets, repeated
ready/close without receipts, and a later independent outage after ACK progress.
These are transport simulations, not proof that Speechmatics transcribed all
three device-test sentences. A reconnected provider bridge still cannot certify
the original recording's complete source coverage; that boundary is unchanged.

A subsequent startup report still shows the generic encrypted-storage error.
Its native cause has NOT been established. A separate regression reproduces
the same message when four unresolved journal entries prevent a fifth start.
The client now checks capacity before creating a remote recording and retains
the atomic insertion check for concurrent attempts. Neither check evicts audio
or tombstones. Storage opening reports fixed, non-sensitive stage codes for
journal, file, key, database, cipher, schema and ready-publication failures;
native exception text, SQL, paths and keys remain excluded. This removes the
ambiguous error and prevents new remote sessions on known local capacity
failure; it does not constitute device acceptance or automatic recovery of
the previous recordings. The four-entry/2048-byte bound is unchanged.

The subsequent device `AUDIO_CAPACITY` report confirms capacity exhaustion.
Its closure retry returns 404; this does not identify which missing route or
session caused it and does not grant successful closure. The prior single
journal design kept cleaned tombstones in all four audio slots. Increasing
audio retention/capacity or evicting history would hide that design problem.
We chose the separate bounded metadata history above, retaining both loss
protection and the existing active-audio limits. Capture admission runs cleanup
first; a failed old cleanup keeps its own slot reserved, while independently
verified free slots remain usable. If cleanup/history reads cannot establish
available capacity, capture still fails closed. The remaining 20-entry closure
history limit must be resolved through actual server reconciliation, not eviction.

Tests cover migration of four legacy tombstones, original-TTL expiry, a fifth
capture, preservation of unexpired PCM, archive/main write and readback failures,
restart protection, no gap in HTTP-finish denial, owner isolation/logout, bounded
history and explicit abandonment even at the history limit. The capacity panel
no longer suggests that selecting a different meeting bypasses a full store.
Native device acceptance remains required; server PR1201 is still open and the
backend main branch lacks the new gateway abandonment route at this check.

Tests use actual SQLite for rollback, reopened loss counters and persistent-file
cleanup, with injected native boundaries. A synthetic cipher capability in
those tests does not validate SQLCipher. Native keychain/keystore protection,
encrypted on-disk bytes, OS interruptions, long recordings and physical expiry
still require an Android/iOS package and device tests. The root alternative for
durable transcript proof is tracked server-side; gateway admission ACK remains
insufficient.
