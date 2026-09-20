# iOS PCM capture lifecycle — #4 / #6

Status: source implementation; macOS compile and physical acceptance pending.
Date: 2026-09-20.

## Problem and decision

Installed expo-audio 57.0.4 handles background/interruption events for its
AudioRecorder registry, but its PCM AudioStream is outside that registry.
The mobile background capability gate was Android-only. Enabling a switch or
UIBackgroundModes alone does not complete interrupted PCM capture cleanup.

Keep Expo PCM capture with a contained iOS-only config plugin. The plugin
requires the reviewed package version and complete source SHA256 values for
AudioStream.swift and AudioModule.swift; unknown upstream/partial patches stop
prebuild. Both files validate before either is written. Repeated application
requires the exact expected output. The replacement carries the Expo MIT license.
Android's existing local foreground-service module is unchanged.

An independently owned capture engine would remove upstream patch maintenance,
but duplicates Expo capture integration and needs a larger native-module proof.
The current gap is explicit lifecycle/cleanup code missing from the PCM class;
the contained extension is the chosen scope. An upstream PCM lifecycle API
should replace this patch when it provides equivalent behavior and evidence.

## Native behavior

- Per-stream capability version and stopped-only background configuration;
  no global background switch. The Expo JS hook forwards only format options,
  so the extension uses an instance method rather than a constructor option.
- Foreground initiation on main; a serial control queue handles ownership,
  start/stop and terminal transitions. Only one PCM stream owns AVAudioSession.
- Each start owns an engine/context, converter, callback gate and observers.
  Start failures clean up an installed tap and activated session even before
  isStreaming becomes true. Unsupported conversion fails without a Float32
  fallback advertised as PCM16. Audio timestamps use host-time conversion.
- Taps never wait synchronously on the control queue. Closing the callback gate
  releases its lock before engine teardown. Notification handlers enqueue
  teardown asynchronously; deinit transfers resources without retaining self.
  See [Apple's engine configuration notification warning](https://developer.apple.com/documentation/foundation/nsnotification/name-swift.struct/avaudioengineconfigurationchange).
- Interruption began, media-services lost/reset, input route loss, engine
  reconfiguration and conversion failure stop with fixed reasons. Foreground
  return and interruption end never automatically reopen the microphone.
- didEnterBackground stops non-opted streams natively. Explicitly opted-in
  streams use UIBackgroundModes=audio and the system microphone indicator.
  There is no timer or automatic 60-second stop. No raw audio is written here.

## Client handoff

Old native builds lack the per-stream capability and cannot offer iOS background
capture. iOS never requests Android notification permission. The screen subscribes
before start; capture IDs reject delayed status/buffers from a previous recording.
Terminal reason is retained natively so start-promise completion cannot erase a
later-delivered interruption event. Both delivery orders enter canonical gateway
drain / HTTP finish once and preserve the specific cause. Unknown reasons are
mapped to fixed text rather than logged verbatim.
The iOS inactive state (for example a system sheet) is not reported as a
background transition; actual background and native interruption are distinct.

## Evidence and remaining acceptance

Plugin tests cover source drift, version mismatch, pre-write validation and
repeatability. JS tests cover capability, permission separation, both terminal
event/start-promise orders, stale capture IDs and the existing 120-second recording
case. These do not execute AVAudioEngine. The separate macOS workflow prebuilds,
installs pods and compiles a Release simulator app without signing or submission.
An unsigned simulator build is not iPhone installation or background acceptance.

The first Mac run [35517561654](https://github.com/Halildeu/platform-mobile/actions/runs/35517561654)
stopped in ExpoModulesJSI before AudioStream compilation: installed Package.swift
requires Swift tools 6.2, while the runner's default Xcode 16.4 provides Swift 6.1.
The workflow selects Xcode 26.2 explicitly for all steps and checks its compiler
against that installed package requirement before pods/build. Xcode, Swift, SDK
and CocoaPods versions are saved with the build evidence. The exact runner image
[lists Xcode 26.2](https://github.com/actions/runner-images/blob/macos-15-arm64/20260907.0337/images/macos/macos-15-arm64-Readme.md);
[Apple documents Swift 6.2.3 in that release](https://developer.apple.com/documentation/xcode-release-notes/xcode-26_2-release-notes).
No fallback to the runner default or dependency tools-version downgrade is used.

Physical compatible iPhone and Android tests remain: explicit opt-in/out, >60s
locked recording and long recording, call interruption, headset disconnect,
media reset where reproducible, no auto-resume, fresh user start, microphone
indicator, PCM16/16kHz/mono transport, drain/finish and saved-result reopen.
Neither #4 nor #6 closes from source or a simulator compile alone.
