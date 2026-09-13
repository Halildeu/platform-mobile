# Native notifications — #9

Status: mobile navigation implemented; native token registration and delivery are NOT integrated.

Proposed data payload (must be agreed with notification service):

```json
{"eventType":"meeting.summary.ready","meetingId":"06dbefb9-242b-4b4d-b4d5-d444e66b6dfe"}
```

Also accepts meeting.action.assigned and meeting.transcript.ready. Sender-provided URLs and content are not rendered. Default notification taps open live-test with a pending meeting ID. Interactive login or session restoration must finish first. The meeting must occur in the server-returned authorized list, and canonical result fetching is separately authorized by the server. A missing list entry is explicit, not a claim that access is forbidden; refresh can retry. Active recording is not stopped to switch meetings.

Cold-start notification responses and taps while running are handled. Last processed native response is cleared. No token, audio or transcript is logged. No permission prompt or device registration is triggered by this implementation.

Remaining server/operator inputs: native FCM/APNs registration/removal contract, authenticated device ownership and logout handling, sender credentials, event-to-device delivery. The inspected notification-orchestrator PushSubscriptionController supports browser Web Push; do not send a native token to that endpoint. No new paid service is introduced.

Acceptance still required: real notification delivery, tap after login, tap during recording, logout/account switch, inaccessible meeting, cold start, Android/iOS. iOS distribution additionally needs an available signing path. This document does not close #9.
