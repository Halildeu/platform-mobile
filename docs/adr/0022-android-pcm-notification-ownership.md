# ADR 0022 — Android PCM notification owns capture

Status: code review agreed; Android compile and registry tests passed; physical device acceptance pending.
Date: 2026-09-25. Supplements ADR 0013.

The active local foreground module displayed a passive notification and was not
linked to expo-audio AudioStream. The historical plugin containing a stop action
was not applied. Its obsolete automatic timeout must not be reintroduced.

The existing local module now depends on expo-audio and holds a registration for
the actual SharedObject. Native start and stop share a registry lock. A visible
foreground notification must be ready before capture starts. Notification stop,
service destruction and task removal stop PCM directly without waiting for JS.
Registration IDs scope teardown and PendingIntent identity; old actions cannot
stop a later registration. Native terminal reason is stored before PCM stop and
reported to JS. Only explicit notification stop permits normal gateway drain;
unexpected capture/service failure must remain incomplete even if earlier audio
drains successfully. Native RECORD_AUDIO, application notification permission and
the recording channel are rechecked at capture start.

Alternatives considered: opening the app from a notification and asking JS to
stop would leave capture dependent on JS scheduling; activating the old plugin
would revive obsolete capture timeout and upstream patches. Neither is used.
Capability versioning hides the background switch on older APKs. This requires
a new Android APK; no OTA, iOS, STT, server endpoint or disk retention change.
Expo SDK 57 uses prebuilt Android AARs by default. `buildFromSource: ["expo-audio"]`
keeps the reviewed AudioStream API available to the local module's Gradle project
dependency; it does not change provider configuration or the upstream source.

Proof requirements: native registry tests (stop-before-start, stale registration,
reason ordering, failure, visibility gate), native compile, then physical Android
notification stop, locked screen, channel disabled and task removal. Unit tests
are not physical-device evidence. Provider timing/name segmentation is unrelated
and remains deferred. A conservative 10-second PCM progress check stops an
unresponsive stream as incomplete, including at stop if the timer was delayed.
Silence continues to produce PCM; there is no total recording duration limit.
This JS progress check does not claim native negative-read error propagation or
uninterrupted background delivery while the OS suspends application execution.
