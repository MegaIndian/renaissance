# Testing

Five layers, all run by `pnpm test` and CI except the Jellyfin suite and the simulator run, which need a real server.

| Layer                     | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Runs                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Unit, core                | `packages/core/test` (Vitest, coverage floor 80 % on lines, branches, functions, statements)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `pnpm test`, CI                                                     |
| Unit, web                 | `apps/web/src/**/*.test.tsx` (Vitest, jsdom, Testing Library; a fake adapter and a fake audio port in `src/test/fakes.ts`; `fake-indexeddb` for the vault and the cache; coverage floor 82 % statements, 77 % branches, 77 % functions, 84 % lines)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `pnpm test`, CI                                                     |
| Unit, mobile              | `apps/mobile/src/**/*.test.ts(x)` (Jest with jest-expo and React Native Testing Library; in-memory stand-ins for SecureStore, RNTP, expo-network and AsyncStorage in `jest.setup.js` and `src/test/`; the SQLite store runs real SQL on Node's `node:sqlite`; coverage floor 70 % statements, 55 % branches, 68 % functions, 73 % lines)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `pnpm test`, CI                                                     |
| Browser, static           | `apps/web/e2e/accessibility.spec.ts` (Playwright on Chromium against the built app: focus outline colour and width, 24 and 30 px targets including the Ask bar's input and a tap on its box edge, not-found shell, favicon, the chart ink on every swatch read from rendered pixels in both themes) and `signin.spec.ts` (the 8 s request timeout against a host that never answers, https first for a scheme-less address with the http notice before anything is sent, the Content-Security-Policy meta)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `pnpm --filter web e2e`, CI                                         |
| Browser, against Jellyfin | `apps/web/e2e/demo.spec.ts` (sign in; the artist page by every id the server holds for the name, from the grid, from the album and with the server down; row geometry; play with the server's play count rising; three reloads that are not plays; favourite, with the heart pressed at once on the list and on the album page; playlist create, rename, add, keyboard reorder read back from the server, undo, a second user who cannot see it, delete; the bar at 820 px, its five transport buttons on one row at one bar height from 768 to 900 px in simple mode, and from 1024 to 1366 px in simple mode with the scrubber at least 160 px; now playing above the fold at 1280×800 and 390×844; no sideways scroll at a 25 px root; placeholder and genre labels in the chart ink from pixels in both themes; the Ask bar from the cache; on a phone the last song's menu opening above its button with all six items inside the main area and the first song's below, the current row's glyph pause while playing and play while paused as the bar's button; sign out removing the library database; a browser that blocks IndexedDB still signing in and loading the library in memory) | `pnpm --filter web e2e` with the variables below; **skipped in CI** |

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

The suite cleans up after itself: favourites off, `e2e *` playlists and `e2e-user-*` users deleted
before each test, and after each test the device records its browser sign-ins created (each context
signs in from a fresh `renaissance.deviceId`) deleted through `DELETE /Devices`, with the suite's
own API device ids (`pw-e2e`, `pw-e2e-other`) deleted last. It raises the play count of one track by
one each run. The demo user must be a Jellyfin administrator for the second-user test and the device
clean-up. Jellyfin keeps one token per device id, so the suite signs the second user in from its own
device id and takes a fresh token before each administrative call.

## The mobile app on the iOS Simulator

The app uses native modules (RNTP, SQLite, SecureStore), so it runs from a development build, not
Expo Go. Xcode with an iOS Simulator is enough; no Apple Developer membership is needed.

```sh
pnpm install
cd apps/mobile
npx expo prebuild --platform ios      # writes apps/mobile/ios (ignored by git)
npx expo run:ios --device "iPhone 18 Pro"   # builds, installs, starts Metro and opens the app
```

Manual check against the demo server, in this order:

1. Home shows "Sign in to a server to see your music here". Tap **Sign in**.
2. Type the demo address, user and password; an `http://` address shows the clear-text notice.
   Tap **Sign in**. Home greets the user by name and says "Last refreshed just now".
3. **Library**, **Albums**, tap the album. Tap **Play**: the bar at the bottom shows the first song
   with a pause button, and Jellyfin's dashboard (or `GET /Sessions`) shows the phone playing it.
4. Tap the bar to open **Now playing**; the time moves. Tap near the end of the scrubber: the next
   song of the album starts by itself.
5. Tap **Queue**: Now playing, Up next with move and remove, Played earlier.
6. Swipe the sheet down. On a song's **⋯**, **Add to favourites**: the toast says so, Jellyfin
   lists the favourite; **Undo** takes it back.
7. Go to the Home Screen (⌘⇧H in the Simulator): the music keeps playing, and the position in
   Jellyfin keeps moving.
8. Quit and reopen the app: still signed in, the queue is back, paused.
9. Settings (gear), **Sign out**: Home is signed out again.

## Diagnostics

The web app swallows the errors it can live with (a cache write in a private window, a push it could
not apply) and says nothing by default. Set `localStorage['renaissance.debug'] = '1'` in the browser
console: from then on every swallowed error is logged with where it happened.

## Screenshots

`pnpm --filter web screenshots` retakes `docs/screens/phase-1` from the production build at 390, 820
and 1280 px, English and Gujarati, dark and light, simple and advanced. With the demo variables set it
signs in first so the library, artist, queue and now-playing shots have real songs; without them it
takes the signed-out set. `pnpm --filter web screenshots phase-0` retakes the phase 0 set.

## Bundle budget

`pnpm --filter web size` (after a build) walks the static import graph from `dist/index.html` and
fails when the shell's first-load JavaScript is over 200 kB gzipped. Route chunks are lazy and do not
count. CI runs it after the web build.
