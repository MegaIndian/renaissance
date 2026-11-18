# Phase 1 screenshots

Taken from the production build with Playwright's Chromium at exact viewports (device scale 2):
phone 390×844, tablet 820×1180, desktop 1280×800, English and Gujarati, dark and light, simple and
advanced mode, signed in to the demo Jellyfin (four Kevin MacLeod tracks, loose files, so there are no
albums and the placeholder art stands in for covers). Retake them with
`pnpm --filter web build && pnpm --filter web screenshots` with the `RENAISSANCE_DEMO_*` variables set
(`docs/testing.md`). The URL parameters `?lang=`, `?theme=` and `?mode=` select the language, theme
and mode for a run.

| File pattern                                  | What                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `home-{phone,tablet,desktop}-en-dark.png`     | Simple-mode home, signed in: greeting by name, My songs, Recently played, Made for you         |
| `home-*-gu-light.png`                         | The same in Gujarati, light                                                                    |
| `home-desktop-en-dark-advanced.png`           | Advanced home: Recently added and Most played rows, Search in the sidebar                      |
| `library-songs-*.png`                         | Library, Songs section, with the player bar                                                    |
| `library-songs-desktop-gu-light-advanced.png` | Advanced library: sort, favourites, genre and year controls, Gujarati, light                   |
| `library-artists-tablet-en-light.png`         | Library, Artists grid, tablet                                                                  |
| `artist-*.png`                                | Artist page: play, shuffle, heart, songs                                                       |
| `now-playing-*.png`                           | Now playing: art, scrubber, transport; `-advanced` names the lyrics and cast phases            |
| `queue-*.png`                                 | Queue: now playing, up next with drag handles and menus, clear                                 |
| `settings-*.png`                              | Settings: mode, appearance, playback quality, account, library, about                          |
| `sign-in-*.png`                               | Sign in: address, user, password, Quick Connect, phone dark English and desktop light Gujarati |
| `ask-results-desktop-en-dark.png`             | The Ask bar's instant library results while typing                                             |
