# Native notifications — #9

Status: mobile navigation and opt-in native registration are implemented in the
draft source stack. TEST server activation and physical delivery are not verified.
See [native-push.md](native-push.md) for the current registration contract,
account cleanup and operator prerequisites.

Data payload accepted from the native notification sender:

```json
{"eventType":"meeting.summary.ready","meetingId":"06dbefb9-242b-4b4d-b4d5-d444e66b6dfe"}
```

Also accepts meeting.action.assigned and meeting.transcript.ready. Sender-provided URLs and content are not rendered. Default notification taps open live-test with a pending meeting ID. Interactive login or session restoration must finish first. The meeting must occur in the server-returned authorized list, and canonical result fetching is separately authorized by the server. A missing list entry is explicit, not a claim that access is forbidden; refresh can retry. Active recording is not stopped to switch meetings.

Cold-start notification responses and taps while running are handled. Last processed native response is cleared. No token, audio or transcript is logged. A tap does not request permission or register the device; enrollment is a separate explicit action in settings.

The draft native backend uses `/api/v1/notify/native-push/registrations` and
authenticated installation ownership. The browser `PushSubscriptionController`
is a separate path and must not receive native tokens. Provider credentials,
authorized TEST activation and event-to-device delivery still require runtime
verification. No new paid service is introduced.

Foreground presentation is handled at the application root. Only the three
recognized meeting event types, valid meeting IDs and the sender's static
`Toplantı güncellemesi` / `Toplantı sonucunu uygulamada görüntüleyebilirsiniz.`
text are eligible. The handler checks an unexpired in-memory session and an
enabled same-owner, same-application/provider/environment receipt. It does not
restore/refresh the login session or request a token. Local checks have a one
second deadline; storage failure, timeout, logout, changed configuration or
unknown content suppress presentation. Sound and badge are disabled. Other Expo
notifications are suppressed by this foreground handler. Android recording's
native foreground-service notification is independent. Background presentation
is controlled by the OS/provider and still needs physical acceptance.

Acceptance still required: real notification delivery, tap after login, tap during recording, logout/account switch, inaccessible meeting, cold start, Android/iOS. iOS distribution additionally needs an available signing path. This document does not close #9.
