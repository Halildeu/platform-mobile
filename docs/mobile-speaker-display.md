# Live anonymous speaker display

Source scope for #8. The live gateway already sends optional
`speakerAttribution` on final transcript events; the mobile stream previously
discarded it. The screen now carries validated attribution through the
transcript state into the virtualized transcript view.

## Contract

Compared with platform-backend source
`5e6b0aedec409aef8f59b32d970dcd47c47cfab4`:

- `common-meeting-events/.../SpeakerAttribution.java` defines a UUID `scope`
  and 1–512 anonymous speaker turns. Each turn contains `speaker`, `textStart`,
  `textEnd`, `startMs`, `endMs`.
- `audio-gateway-service/.../LiveSttWebSocketProxyHandler.java` publishes this
  as `speakerAttribution` alongside final text and source sample boundaries.
- Text offsets use UTF-16. Ordered, non-overlapping spans must cover all
  non-whitespace text without cutting surrogate pairs. Acoustic turn times
  can overlap and must fit the source window (16 kHz PCM).

The client accepts these fields only after validation. Bad optional metadata
falls back to the original transcript text; it does not discard speech. No
speaker identifiers, attribution payloads or transcript contents are added to
diagnostics. This does not invent a separate `speaker_change` wire message.

## Display and corrections

Labels are anonymous localized numbers, scoped by `(scope, speaker)`. A new
scope cannot identify a speaker from an earlier scope. `UU` displays unknown
speaker and does not receive a number. The UI explains that these are not
verified personal identities. Original text, including whitespace between
turns, remains present and selectable.

Repeated final events with identical text and metadata are deduplicated.
Changed attribution with unchanged text updates the row. A corrected final
without attribution clears earlier labels. A callback from an obsolete
recording generation cannot write into a newly selected meeting.

## Evidence and remaining work

- Parser tests cover invalid fields, source windows, Unicode boundaries,
  uncovered text, scope isolation and unknown speakers.
- Socket → transcript reducer → actual renderer tests cover valid gateway
  payloads, metadata-only correction, removal and safe fallback.
- Live screen forwarding and late callback meeting-isolation tests cover the
  actual screen callback. The isolation stream mock reports `isStreaming`
  so it exercises an active recording instead of a failed start.
- Full local Jest: 40 suites / 328 tests pass. Separate Codex follow-up review:
  AGREE, with 35 focused tests independently passing. This is source evidence,
  not physical phone or speaker-recognition quality acceptance.

This change does not close #8. Durable speaker-name editing requires an
authorized, versioned backend mapping for `(scope, speaker)`; the inspected
admin transcript edit endpoint is not that contract. Durable transcript
speaker metadata and Workcube ERP submission also need canonical contracts.
PDF/Markdown saved-result export is in PR35; it does not imply ERP delivery.
Real Android/iOS rendering, speaker quality and complete summary/assignee/date
acceptance remain separate tests.
