# Renaissance: rules for Claude Code

Everything is in `AGENTS.md`; read it first and follow it. Short version:

- `pnpm lint && pnpm typecheck && pnpm test` before any change is called done.
- Core is framework-free and tested; screens are thin and built twice (web, mobile) with mirrored names.
- Tokens from `packages/design` only. One blue primary. Flat cards, hairline borders. Simple mode default.
- Strings in `en.json` and `gu.json`, both, same change.
- The hub never invents a song: fixed tool set, acts only on tool results, keys on the hub only (ADR 0007).
- Conventional commits; changeset for user-visible changes; no secrets, no `.env*`, no native folders.
- No tips or "next time" advice in prose, docs or comments.
