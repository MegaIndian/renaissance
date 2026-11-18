# Testing

Three layers, all run by `pnpm test` and CI except the last, which needs a real server.

| Layer                     | Where                                                                                                                                                                          | Runs                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Unit, core                | `packages/core/test` (Vitest, coverage floor 80 % on lines, branches, functions, statements)                                                                                   | `pnpm test`, CI                                                     |
| Unit, web                 | `apps/web/src/**/*.test.tsx` (Vitest, jsdom, Testing Library; a fake adapter and a fake audio port in `src/test/fakes.ts`; `fake-indexeddb` for the vault and the cache)       | `pnpm test`, CI                                                     |
| Browser, static           | `apps/web/e2e/accessibility.spec.ts` (Playwright on Chromium against the built app: focus outline colour and width, 24 and 30 px targets, not-found shell, favicon)            | `pnpm --filter web e2e`, CI                                         |
| Browser, against Jellyfin | `apps/web/e2e/demo.spec.ts` (sign in, browse, play with the server's play count rising, favourite, playlist create, rename, add, delete, the Ask bar from the cache, sign out) | `pnpm --filter web e2e` with the variables below; **skipped in CI** |

## The demo server

`demo.spec.ts` needs a Jellyfin with the four Creative Commons tracks from `docker/demo`. It reads
three variables and never prints them:

```sh
RENAISSANCE_DEMO_URL=http://<host>:8096
RENAISSANCE_DEMO_USER=demo
RENAISSANCE_DEMO_PASSWORD=<printed by docker/demo/start.mjs>
```

Load them into the shell and run the suite against the production build:

```sh
pnpm --filter web build
set -a; source /path/to/your.env; set +a
pnpm --filter web e2e
```

Without the variables the file skips with the reason in the report. GitHub's runners have no route to
a home server, so CI runs the static browser tests only; the Jellyfin suite is the builder's and the
judges' job on a machine that can reach the demo container. To run it on a laptop with Docker:
`node docker/demo/start.mjs` prints the address and the password.

The suite cleans up after itself (favourites off, `e2e *` playlists deleted) before each test, and it
raises the play count of one track by one each run.

## Screenshots

`pnpm --filter web screenshots` retakes `docs/screens/phase-1` from the production build at 390, 820
and 1280 px, English and Gujarati, dark and light, simple and advanced. With the demo variables set it
signs in first so the library, artist, queue and now-playing shots have real songs; without them it
takes the signed-out set. `pnpm --filter web screenshots phase-0` retakes the phase 0 set.

## Bundle budget

`pnpm --filter web size` (after a build) walks the static import graph from `dist/index.html` and
fails when the shell's first-load JavaScript is over 200 kB gzipped. Route chunks are lazy and do not
count. CI runs it after the web build.
