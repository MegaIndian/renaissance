# Working in this repo with an AI coding tool

Read this whole file before changing anything. `CLAUDE.md` points here.

## Commands

```sh
pnpm install                     # once; Node 22+, pnpm 12 (corepack enable)
pnpm dev                         # web (5173) and hub (8787) together
pnpm --filter web dev            # one app
pnpm --filter mobile start       # Expo
pnpm lint                        # eslint on every package, then prettier --check
pnpm typecheck                   # tsc --noEmit everywhere, including mobile
pnpm test                        # vitest in core, design, web, hub
pnpm build                       # web (dist/) and hub (dist/)
pnpm --filter @renaissance/design build:css   # regenerate tokens.css after editing tokens.ts
pnpm changeset                   # add a changeset for a user-visible change
node docker/demo/start.mjs       # demo Jellyfin with Creative Commons music
```

Run `pnpm lint`, `pnpm typecheck` and `pnpm test` before saying a change is done. CI runs the same.

## Where things live

| Path              | What                                                                                    | Rule                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/core`   | Models (Zod), `ServerAdapter`, `JellyfinAdapter`, queue, playback policy, i18n catalogs | Framework-free TypeScript. No React, no DOM, no React Native imports. Every behaviour has a Vitest test. |
| `packages/design` | Tokens (`tokens.ts`, generated `tokens.css`), `DESIGN.md`                               | The only place a colour, radius, size or font is defined.                                                |
| `apps/web`        | React 19, Vite, Tailwind 4, React Router, TanStack Query                                | Thin screens over core. Tailwind utilities map to tokens (`bg-card`, `border-border`).                   |
| `apps/mobile`     | Expo, expo-router                                                                       | Same screens and component names as web. Styles read `@renaissance/design` tokens.                       |
| `apps/hub`        | Fastify. `/health`, `/ask`, `/requests`                                                 | The only process that holds keys. Config from environment variables only. Never log bodies or headers.   |
| `docs/adr`        | One decision per file                                                                   | Add an ADR for any architectural change; never edit an accepted one, supersede it.                       |
| `docs/ROADMAP.md` | F1 to F85 by phase                                                                      | Reference the F-number in issues, PRs and commits.                                                       |

## Design rules (short form; full text in `packages/design/DESIGN.md`)

One blue primary per screen. Flat cards, 1 px borders, no shadows except art and the segmented pill. Muted
neutrals. Segmented controls, not underlined tabs. Compact type; simple mode is 1.25× and shows three rows.
Dark first, light mirrored, both AA. The Ask bar is on every screen. Every action says what it did and can
be undone. Gujarati must fit. Every control has a label.

## The hub's rule: never invent a song

The model acts only through the fixed tool set in `apps/hub/src/routes/ask.ts` (`search_library`,
`lookup_catalogue`, `play`, `queue`, `make_playlist`, `request`, `set_rule`, `explain`). It may not produce a
song, album, artist or id that a tool did not return in the same call. Deterministic paths first: exact title
matches, library hits and simple commands never call the model. One model call per utterance, strict JSON
output. Intent and ranking use `claude-opus-5-5`; batch enrichment uses `claude-haiku-5-5` through the Batch
API. Keys live on the hub only. See ADR 0007.

## Strings

Every user-facing string is a key in `packages/core/src/i18n/locales/en.json` and `gu.json`, added to both
in the same change. Figures and names stay in Latin letters in Gujarati.

## Commits and PRs

Conventional commits (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `build`), optional scope by
package (`feat(hub): ...`). Small commits. Fill the PR template; screenshots for any screen change at phone,
tablet and desktop widths. A changeset for anything a user would notice. Never commit `.env*`, keys, tokens
or generated native folders (`apps/mobile/ios`, `apps/mobile/android`).

## Expo

Expo changes every SDK. Check the `expo` version in `apps/mobile/package.json` and read the matching docs
at `https://docs.expo.dev/versions/v<major>.0.0/` before using an Expo API. Add native packages with
`npx expo install <pkg>` inside `apps/mobile`. Never create or edit `ios/` or `android/` by hand.
