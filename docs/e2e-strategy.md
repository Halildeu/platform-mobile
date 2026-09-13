# platform-mobile E2E strategy — Faz 24 M6

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
