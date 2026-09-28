# Exact recording status

The saved-result panel now has a lazy **Kayıt durumunu kontrol et** entry. It first
loads the selected meeting's existing sessions. The user explicitly chooses a
recording by date/time (including seconds and UTC); absent `startedAt` is labelled
as creation time, not recording start. The newest row is never selected implicitly.
Rows are shown in pages of 20; older rows remain reachable. The existing server
list is unpaginated; malformed, duplicate, wrong-meeting or over-1000-row responses
are rejected rather than silently truncated. Recording URLs and arbitrary fields
are discarded.

The read calls are:

- `GET /api/v1/admin/meetings/{meetingId}/sessions`
- `GET /api/v1/admin/meetings/{meetingId}/sessions/{sessionId}/processing-status`

The second endpoint requires backend draft PR1201 on PR1200/PR1177. The client
validates exact canonical UUID scope, source states, occurrence identities and
immutable recording provenance. Matching saved results require the exact tuple;
same-run or same-version contradictions are rejected even with a null/false
matching flag. A legacy result can have no version/time, with mandatory unknown
closure evidence. A different older occurrence can be shown as older.

Transcript-source and saved-result observations have independent times. Unknown
source state is distinct from awaiting closure. A successful `NOT_FOUND` means
only no saved result for this session at that read; it says nothing about AI work
being queued or running. HTTP404/503 (including an older backend without the route)
are failed reads, never successful absence. HTTP410/423 are erased/pending-erasure
read failures. Refresh clears prior observations before reading. FINISHED and
FINALIZED do not certify lossless audio capture or correct analysis content.

The panel has no persistent cache, automatic polling, content/PCM diagnostics,
recording recovery, finish or abandonment side effects. It does not call the
latest-result helper, whose lifecycle reconciliation remains a separate flow.
Selecting another recording, meeting or account invalidates in-flight updates,
including errors and completion handlers. Account changes on parent rerender or
app-state events drop already loaded metadata. Credential changes during either
authentication or the response cannot publish the old account's observation.

Validation: strict parser, API no-storage/no-lifecycle GETs, account and selection
races, erasure/error clearing, legacy provenance and paged selection tests. The
actual panel was opened in Expo web with local synthetic waiting, incomplete,
unknown, missing-route404 and erased410 fixtures, including a 393px-wide view.
The temporary harness is not part of the app. Native Android/iOS Detox/Maestro
and live backend acceptance remain required; the known repository billing gate
has prevented native CI jobs from starting. No APK or rollout is part of this
change. This does not recover the missing historical meeting or fix action/date
interpretation.
