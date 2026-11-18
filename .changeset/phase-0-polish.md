---
'mobile': patch
'hub': patch
---

Phase 0 polish after the round 3 judges. Mobile: one brand mark (the note from the web favicon) as the app icon, splash, adaptive icon and favicon; spacing and glyphs scale with simple mode like type does; the Play button draws the shared `play` glyph; the Expo SDK 58 versions of react, react-dom, react-native-gesture-handler and react-native-worklets, checked in CI with `expo install --check`. Hub: the container image no longer carries `packages/core` (nothing in the hub imports it yet) and the smoke test polls `/health` instead of sleeping; Node 22.18 or later is required. `pnpm dev` keeps watching the hub after start and stops both servers when it dies, and reads the port from `apps/hub/.env`.
