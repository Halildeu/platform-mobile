# 26 September phone acceptance and reconnect investigation

## Evidence and limits

User tested the ec7c11f Android TEST APK. Ordinary new-meeting start was reported
working before this long test. No new APK was delivered with the reconnect change
described below, and no physical-phone acceptance is claimed for that change.

Meeting: `826eb40a-7e23-4b3f-b84c-19a0db105476`.
Run: `ab3ff22e-6bde-48ac-a9e8-de8207e29586`.
Gateway session: `SES-2fc02b72-2be0-410c-9eb2-93adf295191d`.

The pasted technical report starts on 2026-09-26 at 18:47:00Z. Microphone capture
starts at 18:47:07.257Z. The report cuts off mid-event at 18:47:13.360Z. It contains
no later analysis deliveries, reconnect or stop events. The initial 404 predates
recording. The user could not supply a later report section; do not treat this as
a complete lifecycle trace. Phone clocks below are Europe/Istanbul, UTC+3.

The reference is a supplied synthetic test script: eight assignments, followed by
Elif's visual task moving to Ayşe, Can's link-check task being cancelled, and
Zeynep's 28 September 2026 presentation deadline moving from 10:00 to 11:00.

| Screenshot | Observation | Acceptance |
|---|---|---|
| 21:48, version 10 | Five actions; Zeynep, Ayşe, Sevil, Halil, Deniz | Initial eight-task set not established |
| 21:48–21:49, version 17 | Only Zeynep's full dated task and Mehmet's budget task | Earlier tasks absent from displayed snapshot |
| 21:50–21:52, transcript | Later changes appear above earlier assignments; several paragraphs marked `düzeltildi` | Suspect sequence identity/order, not evidence of semantic correction |
| 21:52–21:53, version 28 | Six meaningful tasks plus orphan `11 olacak.` | Seven entries are not seven valid tasks |
| Version 28 actions | Visuals assigned to Ayşe; Zeynep's complete task absent | Transfer visible; deadline update failed |
| Version 28 decisions | Can cancellation present; orphan `11 olacak.` also present | Cancellation sentence detected; Can's absence alone cannot prove task removal, as he was absent earlier |
| Version 28 summary/decision | Presentation year 2020 instead of reference 2026 | Incorrect output; unseen initial transcript prevents assigning the cause to STT |
| 21:53 status | Audio connection re-established, waiting chunks being sent | A reconnect occurred; exact timing/cause and loss remain unproven |

Version 28 remains the same in the final screenshots. This does not establish
that another analysis ran or that a precise 45/120-second interval elapsed.
The unrelated transcript phrase and changed anonymous speaker numbers cannot be
labelled hallucination or a real speaker change without original audio/evidence.

## Reproduced mobile defect and bounded fix

Backend source inspected read-only at origin/main
`212fac600f7ca930319241c258a9d216d0068ffd` creates a new Speechmatics adapter and
transcript accumulator for each bridge. `nextFinalSequence` starts at zero in each
adapter. The accumulator explicitly owns one sequence space per reconnect. Public
final events retain that connection-local sequence. This source inspection alone
does not prove the exact backend revision serving the phone at recording time.

The ec7c11f mobile reducer identified a line only by `seq`. A synthetic sequence
of old connection final(0), final(1), then new connection final(0) retained only
two lines and marked the new first line revised. It replaced earlier speech and
sorted the new speech above remaining old speech. This independently reproduced
bug fits the screenshot shape but is not a recovered phone trace.

The fix carries a client-local socket generation into the mobile reducer and keys
and sorts lines by `(connectionId, seq)`. Wire sequences, source sample ranges,
speaker proof and text remain unchanged. Closed-socket callbacks remain ignored.
Same-connection duplicates and revisions preserve prior behavior. An unfinished
draft at connection loss is retained, isolated and labelled unfinalized immediately,
even when the next connection receives no speech. New recording starts clear the
view and old-run callbacks remain guarded.

Normal diagnostics add a numeric connection value on final events and a numeric
connection-closed event. Detailed content capture remains withdrawn. The local
connection value is not the server's speaker/source epoch.

Validation: 54 suites / 562 tests, TypeScript, ESLint and diff-check passed.
Independent Codex plan and final review AGREE; reviewer independently ran eight
affected suites / 122 tests. Expo web export passed. The browser demo at
`/transcript-demo?scenario=reconnect` preserved all three connection texts in order
with the interrupted draft separately labelled. This is a synthetic renderer test,
not Android/iOS network or microphone acceptance. No native APK was built for this
delta; native Detox/Maestro/phone acceptance remains open.

## Saved result still missing: separate unresolved failure

The user subsequently reported `Kaydedilmiş sonuç bulunamadı` from the same
meeting's Saved result after hours. This is not evidence that processing continues.

The current client has two relevant existing behaviors:

1. `ForegroundStream.completionConfirmed()` becomes false after an observed close,
   including a successful reconnect. `completeCapture(false)` persists unknown
   completion and returns without gateway finish/canonical lifecycle sync. Retrying
   unknown completion does not manufacture successful delivery proof.
2. `meetingViewCache` is only a process-memory navigation cache: one-hour expiry,
   at most five meetings. It is lost on process exit/account cleanup. A live draft
   therefore cannot stand in for a saved server result.

This combination can explain a vanished live view and absent saved result after
reconnect. The truncated phone report does not prove the actual stop result for
this session, and no meeting-specific server lifecycle read has yet been obtained.
Local kubectl has no configured context. An existing read-only TEST metadata
workflow was dispatched (run 36270582025); it reads deployments, not this meeting's
database state or private transcript.

That read-only workflow passed at 20:47Z: all three services had one ready replica,
and meeting-service stayed stable for its 120-second gate. Audio-gateway image:
`sha256:4e1f4431bd7ef7f78cd1cc934b8472ce6dd9ac84675dad2a9564dfe309ac4307`.
Meeting-service image:
`sha256:0ca70cceab8667b3e599451c96e5ff20b65671d3c2995a5b926c6c5608928223`.
These health readings do not prove this recording was finalized or its result
exists. No runtime mutation or credential export occurred.

Do not remove the lossless-delivery guard or label a partial recording FINISHED to
make a 404 disappear. The required product path is explicit incomplete-recording
closure with accessible retained transcript/analysis and clear completeness status.
Backend PR1177 remains an unmerged draft and describes abandonment without a
recording.finished event; deploying it alone is not proof that partial analysis
becomes available. This needs a separate reviewed backend/client design.

Likewise, the mobile display fix cannot repair server-produced `11 olacak.` action
and decision fragments. Compare the actual analysis input, source order, window
coverage and rejection reasons before changing engines or shared STT. If selecting
individual sentences cannot express owner/task/date updates across sentences,
evaluate a structured task-state approach with source evidence instead of adding
more punctuation rules to that approach. Shared STT, AI, backend, GPU and Electron
were not changed by this mobile fix.

Tracking: existing mobile issue #5 and draft PR47. Adding issue #5 to Project #4
was attempted but the installed GitHub token lacks the `project` scope. Board
registration is unverified; credentials/permissions were not changed.
