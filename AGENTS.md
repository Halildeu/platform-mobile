# AGENTS.md — platform-mobile

Bu dosya repo içindeki en yüksek öncelikli giriş yüzeyidir.

## 1. Okuma Sırası

1. `AGENTS.md`
2. Global `~/.claude/CLAUDE.md` HARD RULE seti
3. `CLAUDE.md` (repo-specific tamamlayıcı)
4. `README.md`

Soru tipine göre otoriter kaynak:
- **Mimari karar**: `docs/adr/*.md`
- **Aktif iş**: [Project #4 platform-ai Faz 24](https://github.com/users/Halildeu/projects/4) (Hedef Repo: platform-mobile filter)
- **Audio contract**: `platform-backend/audio-gateway-service/docs/contract-v1.md`
- **KVKK boundary**: `platform-k8s-gitops/docs/adr/0030-kvkk-meeting-intelligence-boundary.md`

## 2. Repo Kimliği

- `platform-mobile` React Native + Expo + TypeScript **kaynak kod + EAS Build artifact** repo'sudur
- Backend Spring Boot `platform-backend`
- STT/AI Python `platform-ai`
- Desktop client `platform-desktop` (Electron — UI pattern reuse mümkün)
- Frontend MFE patterns `platform-web/apps/mfe-meeting`

## 3. HARD RULE (özet)

Global `~/.claude/CLAUDE.md` HARD RULE seti aynen geçerli. Repo özel:

- **PII/KVKK boundary**: Ses + transcript hassas; SQLite encrypted + TTL + auto-purge
- **Audio API**: `expo-audio` → PCM16 → WebSocket; just-in-time permission
- **Background mode**: iOS UIBackgroundModes=audio (only capturing) + Android foreground service + user-visible indicator
- **Cross-platform parity**: iOS + Android her PR Expo Dev Tools'da kanıt
- **EAS Build**: code signing otomatik; App Store + Play Store submit pipeline
- **Cross-AI Peer Review**: Provider-level — RN/Expo repo'da Codex review thread zorunlu
- **Türkçe cevap default**
- **Her İş Project Board'a** (Project #4 Hedef Repo: platform-mobile)
- **HARD RULE — Tarayıcıdan Doğrulanmadan mobile uyarlaması**: Expo dev preview + Detox e2e + Maestro flow ekran kanıtı

## 4. Çalışma Disiplini

- Yeni native module integration ADR + PoC gerektirir (Expo Managed → bare workflow ayrım)
- Audio buffer/storage değişimi KVKK ADR güncellemesi
- Permission request rationale + Settings deep link zorunlu
- Cross-repo değişim (örn. audio-gateway contract) eş-zamanlı PR
- Codex iter plan-time AGREE → direkt impl
