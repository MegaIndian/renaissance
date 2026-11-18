# Phase 0 screenshots

Taken from the production build with Playwright's Chromium at exact viewports (device scale 2):
phone 390×844, tablet 820×1180, desktop 1280×800, English and Gujarati, dark and light. Retake them
with `pnpm --filter web build && pnpm --filter web screenshots` (`apps/web/scripts/screenshots.mjs`).
The URL parameters `?lang=`, `?theme=` and `?mode=` select the language, theme and mode for a run.
`home-phone-en-dark-scrolled.png` is the phone home scrolled to the third row.

| File pattern                                           | What                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| `home-{phone,tablet,desktop}-{en,gu}-{dark,light}.png` | Simple-mode home, signed out (the one primary is Sign in)          |
| `sign-in-*.png`                                        | Sign-in placeholder, phone dark English and desktop light Gujarati |
| `library-*.png`, `requests-*.png`                      | Empty states                                                       |
