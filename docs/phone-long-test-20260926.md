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

### 2026-09-28: selected transcript closure in screen and exports

The canonical transcript response's recording outcome and reason are now retained,
using the same strict pair validator as saved analysis results. Missing legacy
fields normalize to UNKNOWN; contradictory or malformed evidence is rejected.
Alternate UI loaders are checked before rendering as well. This does not infer
complete capture from FINISHED or transfer meeting-wide incomplete counts from a
different analysis result into the selected transcript.

The saved transcript header shows an incomplete/unknown notice, including when
the text is empty. Copy adds a separate `Kayıt bilgisi` section before `Konuşma
metni`; PDF uses a separate notice paragraph. Original/readable mode changes only
the selected text body. Canonical text, hashes, source segments and speaker offsets
are unchanged. No microphone, closure or diagnostic-capture behavior changed.

Validation: the new regression suite first failed 24 cases before implementation.
Final full unit run: 55 suites / 625 tests pass; TypeScript and scoped ESLint pass.
Independent final review AGREE: 10 suites / 113 tests plus TypeScript pass.
Expo web export passed. A temporary localhost-only harness rendered the actual
SavedTranscript panel for INCOMPLETE, UNKNOWN, FINISHED and empty legacy content;
browser checks verified the notice, original/readable switch, copy text and the
HTML handed to the PDF exporter. The harness used synthetic content and intercepted
clipboard/PDF calls: this is not native PDF generation or phone acceptance. The
temporary route was removed before a second successful final web export, which
was checked not to contain it. No native APK or deployment was produced.

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

## 28 September: saved-result refresh misses a recoverable closure

A separate reproducible path does not require a reconnect. `completeCapture(true)`
saves the real drained proof before refreshing authentication and calling gateway
finish. A refresh failure or a lost finish response leaves `completion: confirmed`
and `endedAt: null` in SecureStore. Previously `persistedResult` retried only when
`endedAt` was already present, skipping the pending gateway step. The pending-record
panel and a same-meeting start could already retry; Saved refresh could not.

Saved refresh now retries the selected meeting's confirmed receipt with the original
idempotency key, checks the terminal acknowledgement, then synchronizes canonical
lifecycle before reading the result. The active-microphone check is inside the
lifecycle queue. Unknown/abandoning receipts cannot gain completion proof. Legacy
terminal receipts retain read-only reconciliation. Buffer-loss, ownership and other
meeting guards remain in force. No content storage or new recording is introduced.

Regression: four failures reproduced before the fix; all 84 lifecycle tests and the
complete 54-suite / 575-test run pass after it. The lost-response test retries a
confirmed gateway finish using `alreadyFinished: true` and the same key. Token
renewal failure, storage-loaded proof, active other meetings with/without terminal
timestamps, legacy reads, unknown receipts and all buffer journal states are covered.
TypeScript and ESLint pass. Independent plan/final review AGREE; reviewer independently
ran the 84 lifecycle tests. Storage-loaded proof is not a physical process-restart
test. No new APK, native acceptance or runtime deployment is claimed for this change.

This is NOT a repair of the user's unverified reconnect closure, nor of the task
analysis. `completion: unknown` still needs the explicit incomplete-result product
path described above. A successful lifecycle retry also does not mean final analysis
has finished; the result endpoint remains authoritative.

## 28 September: preserve closure provenance on each saved result

Backend PR1177 now binds UNKNOWN/FINISHED/INCOMPLETE and its bounded reason to the
immutable transcript snapshot, signed capability and stored analysis run. AI PR356
accepts that coordinated contract. The mobile parser treats omitted legacy fields
as UNKNOWN, validates explicit field pairs and retains the selected result marker.
The Saved screen, copied/shared Markdown and result PDF now show the same qualified
notice. A selected incomplete result is identified even if the meeting-wide count
is zero. A FINISHED marker does not guarantee every audio sample was captured; the
warning for another incomplete recording in the same meeting is retained.

Affected root checks passed: seven suites / 166 tests, TypeScript and targeted
ESLint. Independent final review AGREE: five suites / 161 tests and TypeScript;
after the final strict own-property repair, all 23 parser tests passed separately.
The reviewer regression rejects a reason inherited from an object prototype.

These are source/contract checks, not native or physical phone acceptance. No APK
was built or distributed for this delta. The explicit empty/failed-source response,
actual recovery of meeting 826eb40a and action/decision semantics remain open.
This change neither reconstructs missing history nor fixes the orphan time/date.
