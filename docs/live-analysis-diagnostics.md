# Live mobile analysis acceptance

The priority requirement is decisions and actions updating during recording.
The saved result arriving after Stop does not satisfy this requirement.

The live screen now records SSE counters per connection: received bytes,
heartbeat comments, accepted analysis frames, malformed JSON, schema rejection,
unknown event types and buffer overflow. Reports contain no transcript or token.
The final report is captured synchronously before the recording generation is
invalidated; old callbacks cannot append to a new recording.

Interpretation:

- Heartbeats with zero analysis frames prove a live transport signal, not that
  analysis ran. Correlate the meeting and time with gateway request counters.
- Rejected/malformed frames indicate a response contract problem; they must not
  be displayed as verified decisions/actions.
- Accepted frames with empty decisions/actions are distinct from receiving no
  result. The server's verified-only grounding requirement is unchanged.

The accompanying readable-transcript changes assemble display paragraphs,
preserve source content, make long text scrollable, and populate reopened
meeting summary/decision/action tabs from the saved result. An active recording
continues to show its own live snapshots, never the previous saved result.

Source verification includes fragmented SSE delivery before stopping, successive
decision/action updates while the microphone remains active, saved-meeting
isolation, text/PDF formatting and final-diagnostic lifecycle tests.
Real TEST-server-to-phone delivery, background/reconnection/notification tests
and iOS acceptance remain separate gates. Do not close the live-analysis issue
based on unit tests or an APK build alone.
