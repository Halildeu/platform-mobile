# platform-mobile

Meeting Intelligence Mobile Client — Workcube ERP ekosistemine entegre **React Native + Expo + TypeScript** mobile uygulaması.

## Amaç

iOS + Android için meeting katılımcı deneyimi:

- 🎙️ Mikrofon ses yakalama (`expo-audio` real-time PCM stream)
- 📡 WebSocket akış → `audio-gateway-service` (platform-backend)
- 📝 Canlı geçici transkript + kesinleşmiş metin
- 🗣️ Konuşmacı ayrımı (diarization render)
- 📋 Özet + karar + aksiyon paneli
- 🔔 Push notification (FCM Android + APNs iOS — Faz 23 entegre)
- 🔐 Keycloak SSO (OAuth2 PKCE + Expo AuthSession)
- 🌐 Offline buffer + retry (zayıf ağda chunk kayıp engelleme)

Faz 24 M6 Integration kapsamında konumlanır.

## Repo Konumu (Workcube ekosistem haritası)

| Repo | Rol |
|---|---|
| **platform-mobile** (bu) | React Native + Expo mobile client (iOS + Android) |
| [platform-desktop](https://github.com/Halildeu/platform-desktop) | Electron + React desktop client (mac/Windows/Linux) |
| [platform-ai](https://github.com/Halildeu/platform-ai) | Python STT/AI services |
| [platform-backend](https://github.com/Halildeu/platform-backend) | Spring Boot — `audio-gateway-service` + `meeting-service` + `transcript-service` |
| [platform-web](https://github.com/Halildeu/platform-web) | React + Single-SPA — `mfe-meeting` MFE |
| [platform-k8s-gitops](https://github.com/Halildeu/platform-k8s-gitops) | GitOps desired-state |

## Stack

| Katman | Teknoloji |
|---|---|
| **Framework** | React Native 0.76+ + Expo SDK 52+ |
| **Language** | TypeScript 5.7 strict |
| **State** | Redux Toolkit + RTK Query |
| **Routing** | Expo Router (file-based) |
| **Audio** | `expo-audio` (PCM streaming) |
| **Network** | WebSocket native + reconnect strategy |
| **Auth** | Expo AuthSession + Keycloak OAuth2 PKCE |
| **Storage** | `expo-secure-store` (token) + `expo-sqlite` (offline buffer) |
| **Push** | Expo Notifications (FCM + APNs) |
| **Build** | EAS Build + EAS Submit |
| **Update** | EAS Update OTA |
| **Test** | Jest + Detox + Maestro |

## Hızlı Başlangıç

```bash
nvm use 22
npm install -g eas-cli
npm install

# Dev
npx expo start

# Native build
npx expo run:ios
npx expo run:android

# Test
npm test
npm run test:e2e:ios
npm run test:e2e:android

# Production
eas build --profile production
eas submit -p ios
eas submit -p android
```

## Faz 24 M6 Integration — 10 Slice

PR-mobile-01 (Keycloak) → 02 (Audio + WS) → 03 (Live transcript) → 04 (Background audio) → 05 (Offline buffer) → 06 (Diarization + summary) → 07 (Push notifications) → 08 (EAS Build pipeline) → 09 (EAS Update OTA) → 10 (Detox + Maestro)

## Geliştirme Disiplini

[CLAUDE.md](./CLAUDE.md) + global `~/.claude/CLAUDE.md` HARD RULE seti.

## Cross-AI Mutabakat

- Codex `019e879c` (plan-time AGREE)
- Mavis `mvs_c922...` msg `78` AGREE
- Claude AGREE

## Lisans

Internal — Workcube ERP platform.
