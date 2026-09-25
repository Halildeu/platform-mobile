# ADR 0023 — Account-scoped persistent diagnostic history

The ordinary report described here remains metadata-only. ADR0024 adds a separate,
explicitly enabled synthetic-test content table and separate export; it does not
add content to this ordinary report.

The September 25 phone report contains only saved-result reads after re-entry.
The old meeting view cache is RAM-only, expires after one hour and is cleared
on login/logout. It cannot preserve earlier microphone/STT/analysis diagnostics.

Persist structured technical events in a separate SQLCipher database for each
existing issuer/user/company/tenant owner hash. SecureStore holds a random
database key with WHEN_UNLOCKED_THIS_DEVICE_ONLY. Verify key storage and cipher
availability before writing. Never replace an existing database whose key is
missing and never fall back to plaintext. Serialize key creation, use independent
native connections, bind callbacks to the opened handle and selected meeting,
and close stale handles after auth/unmount races.

Logout hides and closes this history; it does not delete it. Reauthenticating as
the same account restores access. This deliberately differs from the volatile
transcript/analysis view cache, which is still cleared. Another account cannot
open the previous account's history through the UI. Uninstall/device storage
reset is not guaranteed to preserve diagnostics.

Only allowlisted event kinds, counters, booleans, validated run/meeting/session/
request IDs and fixed platform/app version values are stored. Arbitrary errors,
HTTP bodies, tokens, names, transcript text, analysis content and PCM are NOT
stored. Revalidate stored rows on export as well as on write. This is metadata
retention, not activation of audio retention or an audio export feature.

Retention: last 30 days, at most 20,000 events per account and eight account DBs
per installation. Time/capacity removal is counted in the report. Time pruning
runs on authenticated read/write; inactive accounts and a killed app cannot
physically purge until next access. UI discloses this limitation. A new account
beyond the cap gets a visible unavailable state; audio remains usable. The user
may erase a selected meeting's diagnostic history, without affecting meeting
content on the server. No automatic external upload is added.

Record capture startup stages, run/session correlation, app lifecycle, transport
counters, final-text sequence/length/punctuation counts, analysis versions and
missing-owner counts, SSE parsing counters, closure and saved-result requests.
Writes are synchronous transactions for each observed event, not an unmount-only
save. Native process termination may still lose an event before JS observes or
commits it. This is not a claim to capture every OS/server event.

The report explicitly distinguishes client observation from backend reasoning:
it does not contain raw provider events, model input, grounding rejection reasons
or historic events lost before this candidate was installed. The root cause of
name punctuation is still open. STT settings, microphone source, Electron, web
and backend contracts are unchanged.

Verification uses real SQLite close/reopen, transactions, pruning and account
isolation with mocked SQLCipher capability; that is not native encryption proof.
Native Android/iOS persistence and confidentiality require physical acceptance.
