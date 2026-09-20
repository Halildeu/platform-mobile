# ADR 0021: persisted speaker display names

Status: proposed source implementation, following ADR0020; no native or runtime
acceptance claimed. Related issue: #8.

Saved transcript speaker numbers currently carry no user-friendly names. Provide
an optional owner-authorized editing layer over each immutable analysis occurrence.
The backend contract is documented in platform-backend
meeting-service/docs/saved-speaker-labels.md. Paired backend changes are mandatory.

The label key is `{scope, speaker}` from verified anonymous attribution. Display
numbers are never sent as identity. Legacy text and unknown speakers remain
readable without an edit affordance. GET supplies current revision and write
permission; PUT changes exactly one name or removes it with null. Names are plain
Text, 1–80 Unicode code points. Identical names do not combine speaker identities.

A synchronous save lock prevents double taps. A lost response or conflict triggers
one GET reconciliation, never a guessed-revision PUT. The user checks the latest
names before retrying. Owner/account, meeting and analysis occurrence guard every
async response, including native-session refresh and request completion.

Editing display names does not alter canonical text, analysis inputs, assignees,
raw text selection/copy or PDF. Stored names are personal data, kept in the exact
finalization row and covered by server erasure/retention, not persisted on-device
by this feature. Read-only owners can see names but cannot edit them.

Release gates: compatible backend migration/readers; explicit new auth grants
(default denied); meeting feature flag (default false); real Android/iOS tests for
edit/reopen, conflict/lost response, account switch, accessibility and unchanged
copy/PDF. Existing GitHub billing/limit failures are not native test evidence.
