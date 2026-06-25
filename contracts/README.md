# WS Stream Events Contract

This folder pins the mobile consumer view of the `live-stt /ws/stream` producer contract from `Halildeu/platform-ai`.

- Canonical producer schema: `docs/contracts/ws-stream-events.schema.json`
- Pinned source: `ws-stream-events.schema.pin.json`
- Mobile boundary: parse and validate server events; do not add live audio capture, runtime WebSocket integration, or backend schema changes here.
- Fixture rule: contract fixtures stay synthetic/redacted. Do not store raw transcript content, audio paths, tokens, user names, or meeting identifiers in this repository.

Run local validation with:

```bash
npm run test:contracts
```

Run pinned-source fetch validation with:

```bash
npm run contract:ws:fetch
```
