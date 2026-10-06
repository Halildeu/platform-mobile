# ADR 0017 — Durable audio discovery and loss-aware cleanup

Status: the 15-minute encrypted buffer is enabled only for preview/QA TEST
packages as approved on 2026-10-05. Production remains off. Native Android/iOS
acceptance and a server-side durable processing receipt remain required before
production activation. This ADR supplements 0001 and the KVKK boundary ADR-0030.

## Failure and decision

An encrypted per-session database alone is not a recovery mechanism: after
process death there was no discoverable list, expired empty queues forgot loss,
and lifecycle retry could finish the gateway session before pending PCM replay.

Use one encrypted SecureStore metadata journal (max four entries, max 2048 UTF-8
bytes). No PCM, transcript or token appears in it. Identity is the SHA-256 of
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

An empty queue alone never permits success cleanup. Only validated transport
`drained` plus no pending/lost chunks can seal the buffer and persist `drained`.
The queue checks, seal and journal transition run under the same lease and
serialized mutation. Canonical HTTP finish refuses unfinished/lost metadata,
including its retry path when starting another recording. Gateway ACK/drained
still do not prove final transcript/analysis persistence.

## Cleanup execution and alternatives

Closed-buffer expiry runs at app-root mount, foreground and a one-minute
timer while the app is active. It uses the ORIGINAL configured retention;
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

The 2026-10-06 device report for meeting 479f4b94-adb7-455d-a857-a1eed670802d
confirms stage 3 completed and microphone capture started at 07:33:59 UTC.
The subsequent airplane/network interruption screenshot reports close 1006 and
38 unacknowledged chunks. The supplied history ends before the interruption,
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

Tests use actual SQLite for rollback, reopened loss counters and persistent-file
cleanup, with injected native boundaries. A synthetic cipher capability in
those tests does not validate SQLCipher. Native keychain/keystore protection,
encrypted on-disk bytes, OS interruptions, long recordings and physical expiry
still require an Android/iOS package and device tests. The root alternative for
durable transcript proof is tracked server-side; gateway admission ACK remains
insufficient.
