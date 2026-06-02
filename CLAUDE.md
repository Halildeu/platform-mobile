# CLAUDE.md — platform-mobile Agent Kılavuzu

> Bu dosya Claude Code / agent session'larında otomatik yüklenir.

> Öncelik: Repo-geneli giriş yüzeyi [AGENTS.md](./AGENTS.md). Global HARD RULE seti `~/.claude/CLAUDE.md`. Çelişki halinde global HARD RULE > AGENTS.md > bu dosya.

---

## Proje Bağlamı

`platform-mobile` Workcube ekosisteminde **Faz 24 M6 Integration** kapsamında React Native + Expo + TypeScript mobile Meeting Intelligence client'ı.

Repo eşleştirmesi: [README.md](./README.md) "Repo Konumu" tablosu.

## Ekosistem Reuse

Standalone değil — Workcube altyapısının uzantısı:

- **Auth**: Keycloak SSO (Expo AuthSession PKCE)
- **Routing**: `audio-gateway-service` üzerinden STT akışı
- **WebSocket**: native WebSocket + reconnect strategy
- **State**: Redux Toolkit + RTK Query (platform-web pattern)
- **i18n**: Workcube Türkçe pattern
- **Push**: Faz 23 notification-service event → FCM + APNs

## Ana Kurallar (HARD RULE — global ⊕ repo)

### Global HARD RULE (otomatik yüklenir)

`~/.claude/CLAUDE.md` HARD RULE seti aynen geçerli (Mavis CLI + Her İş Project Board'a + Tam Otonom + Workspace Teams + Uzun Vadeli Kalıcı Çözüm + CI Kırmızıyken Merge YASAK + Tarayıcıdan Doğrulama + Yarın YASAK + Cross-AI Peer Review + Continuous Autonomous Mode + No Fake Work + Pre-Production Full Authority + Türkçe + Plan Consensus Autonomy).

### Repo-specific (platform-mobile)

1. **PII/KVKK boundary**: Ses + transcript hassas (ADR-0030):
   - Audio buffer expo-sqlite encrypted (`expo-secure-store` key)
   - Lokal cache TTL + auto-purge
   - Crash report PII redacted (Sentry filter)
   - Background capture explicit notification user-visible

2. **Audio API discipline**: `expo-audio` → PCM16 → WebSocket. Permission denied → kullanıcıya net hata + Settings deep link.

3. **WebSocket reconnect**: connection drop → exponential backoff + SQLite chunk buffer + idempotency key (sessionId + chunkSeq).

4. **Background mode**:
   - iOS: `Info.plist` `UIBackgroundModes` = `audio` (only when capturing)
   - Android: Foreground service with persistent notification
   - User-visible background indicator zorunlu (privacy guideline)

5. **Permission requests**: Just-in-time (mic gerektiğinde sor, app launch'ta değil). Rationale göster.

6. **EAS Build pipeline**: development + preview + production profile. Code signing EAS otomatik (App Store Connect + Google Play credentials).

7. **Cross-platform parity**: iOS + Android her PR'da Expo Dev Tools'da çalıştırılmış kanıtı (HARD RULE — Tarayıcıdan Doğrulanmadan İş Bitmedi mobile uyarlaması: Expo dev preview + Detox e2e + Maestro flow).

8. **Cross-AI Codex review**: Jest + RTK Query mock + Detox + Maestro. Codex review thread her PR için zorunlu.

## Pattern'ler

### Expo + RN Yapısı

```
app/                            # Expo Router (file-based)
├── (auth)/
│   └── login.tsx
├── (tabs)/
│   ├── meetings.tsx
│   ├── settings.tsx
│   └── _layout.tsx
├── meeting/
│   └── [id].tsx                # Live meeting view
├── _layout.tsx                 # Root layout (auth guard)
└── index.tsx                   # Redirect to login or meetings

src/
├── store/                      # Redux Toolkit + RTK Query
│   ├── slices/
│   └── api/                    # REST + WebSocket endpoints
├── services/
│   ├── audio-capture.ts        # expo-audio wrapper
│   ├── websocket-client.ts     # Persistent WS + reconnect + SQLite buffer
│   ├── keycloak.ts             # AuthSession PKCE
│   └── notifications.ts        # Expo Notifications + FCM/APNs
├── components/                 # UI components
├── hooks/                      # Custom React hooks
├── i18n/                       # Türkçe + EN locales
└── utils/

assets/
├── icon.png
├── splash.png
└── adaptive-icon.png (Android)

eas.json                        # EAS Build profiles
app.json                        # Expo config (permissions, plugins, scheme)
package.json
tsconfig.json
babel.config.js
```

### Permission Pattern (audio)

```typescript
import { Audio } from 'expo-audio';

async function requestMicPermission(): Promise<boolean> {
  const { status } = await Audio.requestPermissionsAsync();
  if (status === 'granted') return true;
  // Show rationale + Settings deep link
  Linking.openSettings();
  return false;
}
```

### Commit Message

```
<type>(<scope>): <kısa başlık>

<body — neden, ne, kanıt>

<Codex iter referansı varsa>
<Co-Authored-By: Claude ...>
```

Types: `feat` / `fix` / `refactor` / `docs` / `chore` / `test` / `perf` / `build`

### CI Gates (planlı)

- `jest` (>80% coverage)
- `tsc --noEmit` (strict)
- `eslint .` (no warnings)
- `prettier --check .`
- Detox e2e (iOS + Android)
- Maestro flow tests
- EAS Build profile=preview (PR preview build)
- Cross-AI Codex review thread

## Codex Adversarial Protokol

Her büyük delta sonrası Codex MCP adversarial review:
- VERDICT: AGREE / PARTIAL / REVISE / RED
- AGREE → direkt impl (Plan Consensus Autonomy)
- PARTIAL/REVISE → absorb + iter

## Agent Session Akış

1. Oku: [AGENTS.md](./AGENTS.md) → [README.md](./README.md)
2. Bağlantılı repo state:
   - platform-ai → STT services
   - platform-backend → audio-gateway-service
   - platform-desktop → Electron parity (UI pattern reuse)
   - platform-web → mfe-meeting components reuse
3. Kontrol: `git log --oneline main..HEAD | head -10`
4. Memory: `~/.claude/projects/<slug>/memory/MEMORY.md`
5. Project #4 — Faz 24 issue claim (yeni HARD RULE)

## Kaynaklar

- ADR-0030 KVKK Meeting Intelligence Boundary (platform-k8s-gitops)
- Audio Gateway Contract v1 (platform-backend `audio-gateway-service/docs/contract-v1.md`)
- Faz 24 canonical plan (platform-k8s-gitops `docs/faz-24-meeting-intelligence-plan.md`)
- Expo SDK 52+ docs: https://docs.expo.dev
- React Native 0.76+ docs: https://reactnative.dev
