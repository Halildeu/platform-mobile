# platform-mobile E2E strategy — Faz 24 M6

## 2026-09-20 headless emulator detection regression

[Run35514381900](https://github.com/Halildeu/platform-mobile/actions/runs/35514381900)
built and verified its APK, but both flows stopped before installation. All
pre/postflight device health probes passed and transport stayed `device`; the
new host-emulator PID check returned an empty list throughout. The process-name
pattern excluded `qemu-system-x86_64-headless`, so startupReady was false.
This is a source regression in the new observer, not evidence of emulator death.

The runner passes `-no-window`. Android's
[launcher source](https://android.googlesource.com/platform/external/qemu/+/refs/heads/emu-35-3-release/android/emulator/main-emulator.cpp)
selects `qemu-system-ARCH-headless` for that option and execs it. The detector
now accepts the optional `-headless` suffix for x86_64/aarch64 QEMU executables,
retaining the executable-name and exact port5554 boundaries. Real Linux pgrep
fixtures cover both architectures, headless/non-headless names, wrong ports,
and misleading `-headless-extra` suffixes. The new fixture failed against the
previous pattern before the fix. The earlier fixture missed the headless form.

Readiness, observation completeness and Maestro assertions are unchanged. No
failure retry is added. New native CI is still required; this fix does not prove
the earlier intermittent transport failure repaired or physical/iOS acceptance.

## 2026-09-20 preflight transport evidence gap

[Run35511722027](https://github.com/Halildeu/platform-mobile/actions/runs/35511722027)
built the APK and passed transcript-demo, but app-launch stopped before APK
installation. Core readiness and two launcher samples passed; logcat then exited
255 and subsequent device commands exited1. The partial log was61,440bytes, below
the512KiB cap. No app assertion or verified ANR occurred. Existing evidence cannot
distinguish emulator process death, guest adbd loss or host ADB server restart;
guest memory-pressure messages alone do not establish an out-of-memory kill.

The previous observer started only after install. Moreover, synchronous health,
snapshot and install commands blocked its event loop. All observed commands now
use bounded asynchronous processes, and the observer starts before preflight.
Startup requires a target-device frame and valid nonempty host ADB/emulator PID
samples within5seconds. The emulator PID query is scoped to the executable and
port5554 used by the isolated runner. PID rounds do not overlap. Observations
include command start/duration, classified stderr failures, PID probe duration,
sample counts and maximum sample gap. Gaps above2.5seconds make the observation
incomplete. Even complete sampling does not exclude outages shorter than its
actual sampling interval; adb frames and process samples remain separate evidence.

The observer is stopped in a finally path on preflight, installation, Maestro or
collector failure. Skipped installation is explicitly marked instead of producing
an after-install label. Existing nonzero results remain failures; a zero process
exit accompanied by a timeout/buffer error cannot pass. Raw stderr is never saved;
the opt-in disposable-emulator system log boundary and512KiB cap are unchanged.

Regression fixtures hold a logcat/installation command while independently changing
transport and process IDs, and require observations timestamped inside that command.
This repairs missing diagnostic coverage, not the still-unknown CI transport cause.
Do not add test retries, drop readiness checks or claim physical/iOS acceptance.
If fuller evidence establishes instability inherent to the shared runner, consider
a fixed dedicated Android test runner rather than accumulating application patches.

## 2026-09-20 Android UI readiness race

Run 35498487486 on source f220fea built successfully and passed transcript-demo
(one JUnit test, 25.669s). App-launch stopped before APK installation or Maestro:
sys.boot_completed became 1 at 08:30:47.732Z, but the 08:30:48.320Z window dump
still showed mCurrentFocus=null, SDK setup DefaultActivity and FallbackHome.
All probes succeeded and lastanr reported no ANR since boot. The instantaneous
preflight incorrectly treated incomplete UI startup as a failed environment.

Before installation only, the collector now allows up to 30 seconds including
probe duration for setup/null focus to become a usable window. Two consecutive
usable samples 500ms apart are required; setup resets that sequence. Every probe
keeps its 5-second maximum and is shortened to the remaining overall deadline.
ADB/probe failures, malformed window output and focused ANR/error dialogs stop
immediately. Initial and final window dumps and classified timing observations
are retained. Postflight does not wait and cannot erase a failed Maestro result.
This changes startup synchronization, not test assertions or test retries.

New source still requires both isolated native scenarios on the same verified
APK. The partial result above is not full Android, phone or iOS acceptance.

## 2026-09-18 Pixel Launcher ANR and environment correction

Run 35344006973 completed with transcript-demo 1/1 passing and app-launch failing
its unchanged app-root assertion after 30 seconds. The failure screenshot and
accessibility hierarchy show a Pixel Launcher ANR dialog, not an application
crash. Android logged Workcube's Activity displayed at 12:47:31.763Z and React
Native main started at 12:47:32.503Z. Transport stayed device with zero dropped
diagnostic events. Only the system dialog/status bar appeared in the hierarchy.

The available logcat begins at 12:47:17.519Z and contains no originating ANR
stack. Google package initialization/download activity is visible, but CPU
starvation or an upstream launcher defect is not established. Two CPU cores
and automatically raised 2560 MB guest RAM are observations, not proven causes.
The verified failure mechanism is a system modal blocking app accessibility.

For these Google-independent synthetic tests, use Android 35 default/AOSP x86_64
instead of google_apis. Google's SDK catalogue provides
system-images;android-35;default;x86_64 (revision 2 at investigation time).
Remove the earlier Messages-disable workaround rather than accumulating package
exclusions. Do not dismiss ANRs, disable the launcher, extend assertion deadlines
or retry failed flows. Native FCM/Google Play and physical-device acceptance
remain separate and cannot be inferred from an AOSP pass.

The opt-in synthetic CI collector now saves bounded system/events/crash logs,
last-ANR traces, window state and memory before Maestro and after the test, plus
host resource counters and probe outcomes. Each adb probe has a 5-second deadline
and 512 KiB bound. Collection requires GitHub Actions, an allowlisted synthetic
flow and emulator identity. It is not enabled for phones or authenticated flows.
Unavailable readiness probes or a focused system error dialog fail the run;
postflight preserves the original test failure. Test assertions, APK identity
verification, separate JUnit reports and three success screenshots remain required.

This is an environment correction pending native CI verification, not a claim
that the unknown internal Pixel Launcher defect has been repaired.

References: [Android AVD configuration](https://developer.android.com/studio/run/managing-avds),
[ANR diagnosis](https://developer.android.com/topic/performance/anrs/diagnose-and-fix-anrs),
[SDK catalogue](https://dl.google.com/android/repository/sys-img/android/sys-img2-4.xml).

## 2026-09-18 Android flow isolation

Current Android CI builds a real x86_64 APK and runs both existing Maestro flows.
Run35341034945 passed transcript replay, then failed app-launch before its first
UI assertion. Transport evidence shows device -> offline -> absent -> device
between12:09:31.574Z and12:09:32.330Z, with unchanged host ADB PID. The underlying
guest/transport reset trigger is not established; this is not an app crash finding.

Each unchanged flow now runs in its own GitHub runner/emulator lifecycle against
the same SHA/hash-verified APK. Both matrix jobs are required by the aggregate
android-maestro check; fail-fast is off, no failed flow is retried, and reports are
kept separately. App-launch plus revised/replayed transcript screenshots remain
mandatory. A passing artifact build alone cannot satisfy this check. This isolates
the observed cross-flow transport failure without suppressing app assertions.

The correction still requires new-head native CI evidence. It does not establish
physical recording, authenticated backend acceptance, iOS or Detox coverage; #1
cannot be closed solely on these two synthetic Android scenarios. Earlier sections
below describe historical setup and do not override this current runner description.

## 2026-09-10 doğrulama düzeltmesi

Önceki metindeki “çalışan smoke”, “macOS matrix” ve yeşil baseline ifadeleri
cihaz koşumu kanıtı değildir. Mevcut workflow gerçek cihaz/emülatör başlatmıyor.
PR stub artık exit 1 verir; test çalışmadan E2E kabulü göstermez.
Detox iOS yolları Expo'nun mevcut addan ürettiği WorkcubeMeeting adına düzeltildi.
Jest'e TypeScript için babel-jest dönüşümü eklendi; gerçek test dosyasının
dönüştürülüp JavaScript olarak ayrıştırıldığı yerelde doğrulandı.
Android/iOS native derleme başarıları Detox native entegrasyonu veya E2E başarısı
değildir. Runner, Detox instrumentation ve iki platformda ekran kanıtı hâlâ gerekli.

**Status:** ADR-lite • **Author:** Claude Code • **Date:** 2026-07-21
**Tracks:** [platform-mobile #1 — Detox + Maestro + browser MCP wrapper](https://github.com/Halildeu/platform-mobile/issues/1)

## Karar

Two-track E2E: **Maestro** as the primary flow track, **Detox** wired
for the deep-integration cases that outgrow a declarative flow.

## Neden iki track (tek framework değil)

| Framework | Güçlü tarafı | Zayıf tarafı | Bu repoda hangi test? |
|---|---|---|---|
| **Maestro** | Declarative YAML, Expo Go üzerinde direkt koşar; setup 5 dk; CI runner'da rahat | Async wait / native modül assert / background transition zayıf | Smoke, happy-path E2E (login → home → meeting başlat) |
| **Detox** | Native sync (waitFor / expect), background/foreground, permissions; deep native modül testi | Setup ağır: Expo prebuild + eas dev-client; her release'te native binary rebuild | Sesli izin akışı, WebSocket reconnect, arka planda kayıt sürdürme |

Tek framework seçimi (Maestro-only veya Detox-only) uzun vadeli **coverage boşluğu** yaratır:
- Maestro-only: native izin/background flow'unu güvenilir kapsayamıyoruz — bunlar en kırılgan noktalar.
- Detox-only: her PR'da Expo prebuild + native binary rebuild = CI wall-clock ~15dk vs. Maestro ~1-2dk. Frequent smoke için pahalı.

## Şimdi elde ne var (bu PR ile)

- `.maestro/config.yaml` + `.maestro/flows/01-app-launch.yaml` — çalışan Maestro smoke.
- `.detoxrc.js` + `e2e/jest.config.js` + `e2e/app-launch.test.ts` — Detox skeleton (prebuild sonrası aktive).
- `.github/workflows/e2e-mobile.yml` — `workflow_dispatch` trigger + macOS matrix (CI runner seçim owner-touch, aşağıda).
- Renderer testID contract: `app-root`, `meeting-list-header` — henüz app tarafında yoksa CI kırmızı verir → bu **doğru sinyal**: implementator ekler.

## Runner seçimi (owner-touch)

GitHub-hosted `macos-latest` billing-bloklu (memory: GHA billing-block).
Options:

1. **Self-hosted macOS runner** — Zeynep'in Mac'i veya bir Mac mini runner
   olarak kaydedilir. Maestro CLI + iOS simulator burada.
2. **BrowserStack App Automate** — cloud device farm; Maestro entegre.
   Fiyatlı (owner karar).
3. **Local-only** — kullanıcı Mac'inde `npm run test:maestro` çağırılır.
   CI'da workflow_dispatch skip stub kalır.

Şu PR **Opsiyon 3** ile başlar: workflow var + local koşum belgeli;
runner kararı verildiğinde workflow YAML'ı flip edilir (küçük diff).

## Roadmap

- **İ-M1** (bu PR): Maestro + Detox skeleton + workflow + docs
- **İ-M2**: `app-root`/`meeting-list-header` testID'lerini renderer'a
  ekle → Maestro smoke ilk yeşil
- **İ-M3**: Login flow (Keycloak PKCE) + meeting-list happy path
  Maestro'da; deep native izin akışı Detox'ta
- **İ-M4**: Runner kararı + CI enable (workflow_dispatch → auto)
- **İ-M5**: Faz 24 canlı analiz mobile ekranı geldiğinde SSE consumer
  flow'u (Maestro) + reconnect flow'u (Detox)

## References

- Maestro docs: https://maestro.mobile.dev/
- Detox docs: https://wix.github.io/Detox/
- Board issue #1: `[PR-mobile-10] Detox e2e + Maestro flow + browser MCP wrapper`
- HARD RULE — Tarayıcıdan Sonuç Doğrulanmadan İş Bitmedi (mobile
  uyarlaması): browser MCP mobile için yeterli değil → gerçek device/simulator
