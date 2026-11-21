# Renaissance design

The look is borrowed from T3 Code: flat cards, hairline borders, muted neutrals, one blue primary,
segmented controls, dense but calm type. The reference is `docs/design/mockup-2026-11-17.html`
(iPhone Home, Search with one-tap requests, Now Playing; desktop with sidebar and bottom player). The
Spotify-style gradient look was shown first and declined. Every value below lives in `src/tokens.ts`;
nothing in an app defines its own colour, radius or font size.

## Rules

1. **One primary.** Blue (`primary`) marks the one action that matters on a screen: play, add, sign in.
   Everything else is `secondary` (filled, bordered) or ghost (text only). Never two primaries in view.
   A disabled control is never blue: it drops to `muted` until it can do something.
2. **Flat cards with hairline borders.** A card is `card` background, 1 px `border`, `radius` 10 px,
   no shadow. The only shadows are the lifted now-playing art and the active pill of a segmented control.
3. **Muted neutrals.** Greys from the token set; no pure black, no pure white text. Cover art is the only
   saturated colour besides the primary. Placeholder art uses the `chart` colours and only stands in
   for art that exists: an empty row shows an `EmptyState`, never a grid of coloured squares. A
   placeholder is hashed from the item's own id (a track, not its album, so one album without art is
   not one solid column) and skips `chart-1`, which sits a hair from `primary`; genre and year cards
   use all six. Any label drawn on a swatch is `chartInk` (`--chart-ink`), the one near-black that
   passes 4.5:1 on all six in both themes (`measureChartContrast()`); never `background`, which is
   white in the light theme.
4. **Segmented controls, not tabs with underlines.** Filters (`All | Music | Downloaded`) are a pill group
   on a `muted` track with the active segment on `card`.
5. **Compact type, big in simple mode.** Body 13, captions 11, labels 12, titles 15, headings 18, display
   24, all defined in px at a 16 px root and emitted in rem. The web never writes a px size: utilities
   are `text-caption`, `text-body`, `text-label`, `text-title`, `text-heading`, `text-display`, and the
   lint fails on `text-[Npx]` or any other arbitrary value. Simple mode sets the root to 125 %, so every
   size, line height and spacing step grows together, and the browser's own font-size setting does the
   same. Simple mode never shows more than three rows.
6. **Dark first, light mirrored.** Dark is the reference; the light theme has the same contrast
   relationships. Text passes WCAG AA (4.5:1) on every surface it is drawn on, and control boundaries
   (the primary button, form input borders in `inputBorder`, and the focus outline in `ring` against
   every surface it is drawn next to: `background`, `card`, `muted`, `secondary` and the `primary`
   button) pass 3:1. `ring` is therefore not the primary blue: it is a pale blue in dark and a navy in
   light, the one colour that reads on all of those. Card and row hairlines (`border`) are decorative,
   sit around 1.3:1, and are never the only thing that shows an edge. The table under "Measured
   contrast" is computed from the tokens by `src/contrast.ts`; the test fails the build if any pair
   drops below its line.
7. **The Ask bar is on every screen.** One box, placeholder "Ask for anything" (the examples live in
   the hint line under it, `ask.hint`), a magnifier glyph and a shortcut hint on desktop: `⌘K` on a
   Mac, `Ctrl K` elsewhere, picked from `navigator.platform`; either key focuses it. The shell renders
   it, not the screens: on desktop it is the top bar above the content; on phones it sits above the
   player and the tab bar. Library hits appear instantly under it; the model's answer streams in under
   them as cards with actions and an undo.
   **Focus, on the Ask bar and every other control:** a 2 px solid `ring` outline 2 px outside the
   control (`apps/web/src/components/focus.ts`, applied to buttons, links, tabs, sidebar items,
   segments and inputs), with a 3 px 25 % `primary` halo as decoration only. The outline is what the
   contrast table measures; the halo is never the indicator.
8. **Hairlines between rows, never zebra stripes.** Lists are rows separated by 1 px `border`, 34 px art,
   title in body-strong, subtitle in caption `mutedForeground`.
9. **Progress is quiet.** 3 px bars on `muted`, `info` fill; a request card says what is happening in
   words ("Downloading 14 of 18") and when it will be done.
10. **Every action shows what it did and has an undo.** No silent changes; no confirmation dialogs for
    reversible things.
11. **Gujarati fits.** Strings are longer in Gujarati; every label wraps or truncates with an ellipsis,
    never overflows. Figures and names stay in Latin letters. `html lang` and the mobile
    `accessibilityLanguage` follow the chosen language from the first paint, not from the first tap.
12. **Accessible by default.** Every control has a label from the catalogs (no literal strings in JSX;
    the lint fails on them); focus is visible (rule 7); every control is at least 24 × 24 px in
    advanced mode and 30 × 30 px in simple mode (segments, sidebar items, tabs, buttons; the Playwright
    test in `apps/web/e2e` measures them); `tokens.css` turns animation and transitions off under
    `prefers-reduced-motion: reduce`, and mobile reads `AccessibilityInfo.isReduceMotionEnabled` through
    `useReducedMotion` and gets zero durations from the theme; type scales with the system setting.

## Simple mode (the default for every profile)

The home screen for Mom and Dad, and the default for everyone until they switch to advanced in
Settings (reached from the avatar: the gear at the top right on phones, the Settings row in the
sidebar on desktop; `?mode=advanced` in the URL overrides for one visit, used by screenshots and e2e).

```
┌────────────────────────────────────────┐
│ Good evening, Sahil                    │  display, 1.25×; morning, afternoon or evening by the clock
│                                        │
│ My songs                               │  heading: this user's favourites (F12, F86)
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │  square art, 1.25× titles, horizontal scroll
│ └──────┘ └──────┘ └──────┘ └──────┘   │
│                                        │
│ Recently played                        │  the server's ranking, so plays from other clients count
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│ └──────┘ └──────┘ └──────┘ └──────┘   │
│                                        │
│ Made for you                           │
│ ┌────────────────────────────────────┐ │  one quiet sentence until phase 4; no phase number here
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ ○  Ask for anything…               │ │  Ask bar, solid focus outline (shell, every screen)
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ ▣ Drowning · A Boogie      (▶) (⏭) │ │  now-playing bar, one primary button; 3 px progress hairline
│ └────────────────────────────────────┘ │
│  Home        Library       Requests    │  three tabs, no Search tab (the Ask bar is the search)
└────────────────────────────────────────┘
```

Three rows, nothing else: no genres, no sort menus, no settings on the home screen. Signed out, each row
is one `EmptyState` card with a full sentence, and the one primary on the screen is **Sign in**; the
sign-in card's art is the person glyph, not a placeholder square (rule 3). An empty row signed in is
one sentence that says what fills it ("Tap the heart on any song and it joins this row").

### Simple versus advanced

The switch is `Settings.mode` in `packages/core/src/settings.ts` (`'simple' | 'advanced'`, default
`'simple'`), stored per browser by `apps/web/src/lib/settings.ts` and applied as `data-mode` on the
root element, which tokens.css turns into the 1.25× root. The Settings screen shows it as a
`SegmentedControl` labelled `settings.mode` with a sentence under it saying what changes. Mobile reads
the same schema in phase 3. Phase numbers appear in the interface only in advanced mode (the mixes
row, the lyrics and cast buttons, the download menu item, diagnostics).

|             | Simple (default)                                                             | Advanced                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type        | 1.25× every size and spacing step                                            | 1×                                                                                                                                                   |
| Home        | Greeting and three rows: My songs, Recently played, Made for you             | The same rows plus Recently added and Most played; the mixes row names phase 4                                                                       |
| Navigation  | Home, Library, Requests (phone tabs or desktop sidebar)                      | Adds Search as a tab and sidebar item (the full results page behind the Ask bar's instant list)                                                      |
| Library     | Artists, Albums, Songs, Playlists; default sort (name); one layout per kind  | Adds Album artists, Genres, Years; grid or list; sort by name, date added, year, play count, last played, random; favourites, genre and year filters |
| Now playing | Art, title, artist, scrubber, transport, heart, queue; lyrics and cast muted | The same plus direct or transcoded, codec, bitrate and sample rate; the muted buttons say which phase brings them                                    |
| Ask bar     | Yes, every screen                                                            | Yes, every screen                                                                                                                                    |
| Settings    | From the avatar: mode, theme, language, quality, account, library, about     | The same plus the diagnostics line (phase 9)                                                                                                         |

### Playback and lists (phase 1)

- **The queue** (F22) is a screen (`/queue`, the queue glyph in the bar and on now playing): Now
  playing, Up next with a drag handle per row and Move up, Move down and Remove in the row's menu for
  the keyboard, Clear with undo, and Played earlier. Every change is a toast with an undo (rule 10).
- **Menus** (`Menu`) are popovers with `role="menu"`: arrows move, Home and End jump, Escape closes
  and returns focus. A disabled item that belongs to a later phase carries a one-line hint, shown only
  in advanced mode.
- **Dialogs** (`Dialog`, `Dialogs`) are one card, `aria-modal`, focus trapped, Escape closes; used for
  add to playlist, new playlist, rename and delete.
- **Lists** over the cache are virtualised (`VirtualList`); rows are 3.5 rem (`TrackRow`, 56 px at
  the 16 px root, 70 px in simple mode, so the row grows with the type, rule 5), grids use 144 px
  cards (`AlbumCard`, `ArtistCard`, `PlaylistCard`, `LabelCard`).
- **The Ask bar's results** are a `listbox` under the box: up to four per kind, keyboard through
  them, Enter plays a song or opens the full results page; recent searches when empty. Without a hub
  the bar is the search box and says nothing about asking in words (`ask.hintSearchOnly`).

## Tokens

| Group                     | Values                                                                                                                                                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colours (dark)            | background `#0f0f14`, foreground `#e8e8ee`, card `#17171e`, border `#2a2a35`, inputBorder `#6a6a80`, muted `#22222c`, mutedForeground `#9a9aae`, primary `#2f6fe0` on primaryForeground `#ffffff`, ring `#cfdeff`, secondary `#1f1f28`, success `#22c55e` on `#0f0f14`, danger `#f87171` on `#0f0f14` |
| Colours (light)           | background `#ffffff`, foreground `#111118`, card `#f7f7f9`, border `#e3e3e9`, inputBorder `#8a8a9c`, muted `#eeeef2`, mutedForeground `#6b6b7e`, primary `#2563eb` on `#ffffff`, ring `#0b1a3f`, secondary `#f1f1f5`, success `#15803d` on `#ffffff`, danger `#dc2626` on `#ffffff`                   |
| Chart and placeholder art | `#3b82f6` `#14b8a6` `#f59e0b` `#a78bfa` `#f87171` `#a3e635`; label ink `#111118` on every swatch                                                                                                                                                                                                      |
| Radius                    | sm 8, md 10, lg 16, pill 999 (px; radii do not scale)                                                                                                                                                                                                                                                 |
| Spacing                   | 4-point grid: 4, 8, 12, 16, 20, 24, 32, 40, 48 px, emitted as `--space-N` in rem                                                                                                                                                                                                                      |
| Type                      | caption 11/14, body 13/18, label 12/16, title 15/20, heading 18/24, display 24/30 (size/line height, px at a 16 px root, emitted as `--font-size-*` and `--line-height-*` in rem); simple mode ×1.25 on the root                                                                                      |
| Shadows                   | low `0 1px 2px rgba(0,0,0,.15)` (segmented pill), art `0 8px 24px rgba(0,0,0,.25)` (now-playing art); nothing else                                                                                                                                                                                    |
| Motion                    | fast 120 ms, normal 200 ms, slow 320 ms, easing `cubic-bezier(0.2, 0, 0, 1)`; all off under reduced motion                                                                                                                                                                                            |
| Breakpoints               | tablet 768, desktop 1024                                                                                                                                                                                                                                                                              |

Web consumes `tokens.css` (CSS variables, generated from `tokens.ts` with
`pnpm --filter @renaissance/design build:css`, formatted with prettier; a test fails when the file and
the generator differ) through Tailwind 4's `@theme`, which maps `--color-*`, `--text-*`, `--spacing-*`,
`--shadow-*` and `--radius-*` onto the token variables and resets Tailwind's own palette and type scale
so only token utilities exist. Mobile imports `tokens.ts` directly.

### Measured contrast

Computed from `tokens.ts` by `src/contrast.ts` (`contrastTable()`); `test/contrast.test.ts` fails the
build if any pair is below its line, and checks this table matches.

| Theme | Pair                                 | Needs | Measured |      |
| ----- | ------------------------------------ | ----- | -------- | ---- |
| dark  | `foreground` on `background`         | 4.5:1 | 15.66:1  | pass |
| dark  | `foreground` on `card`               | 4.5:1 | 14.61:1  | pass |
| dark  | `foreground` on `muted`              | 4.5:1 | 12.91:1  | pass |
| dark  | `mutedForeground` on `background`    | 4.5:1 | 6.92:1   | pass |
| dark  | `mutedForeground` on `card`          | 4.5:1 | 6.46:1   | pass |
| dark  | `mutedForeground` on `muted`         | 4.5:1 | 5.71:1   | pass |
| dark  | `primaryForeground` on `primary`     | 4.5:1 | 4.70:1   | pass |
| dark  | `secondaryForeground` on `secondary` | 4.5:1 | 13.39:1  | pass |
| dark  | `successForeground` on `success`     | 4.5:1 | 8.39:1   | pass |
| dark  | `infoForeground` on `info`           | 4.5:1 | 4.70:1   | pass |
| dark  | `dangerForeground` on `danger`       | 4.5:1 | 6.91:1   | pass |
| dark  | `success` on `background`            | 4.5:1 | 8.39:1   | pass |
| dark  | `danger` on `background`             | 4.5:1 | 6.91:1   | pass |
| dark  | `primary` on `background`            | 3:1   | 4.07:1   | pass |
| dark  | `primary` on `card`                  | 3:1   | 3.80:1   | pass |
| dark  | `ring` on `background`               | 3:1   | 14.15:1  | pass |
| dark  | `ring` on `card`                     | 3:1   | 13.20:1  | pass |
| dark  | `ring` on `muted`                    | 3:1   | 11.66:1  | pass |
| dark  | `ring` on `secondary`                | 3:1   | 12.10:1  | pass |
| dark  | `ring` on `primary`                  | 3:1   | 3.48:1   | pass |
| dark  | `inputBorder` on `background`        | 3:1   | 3.63:1   | pass |
| dark  | `inputBorder` on `card`              | 3:1   | 3.38:1   | pass |
| light | `foreground` on `background`         | 4.5:1 | 18.80:1  | pass |
| light | `foreground` on `card`               | 4.5:1 | 17.57:1  | pass |
| light | `foreground` on `muted`              | 4.5:1 | 16.24:1  | pass |
| light | `mutedForeground` on `background`    | 4.5:1 | 5.21:1   | pass |
| light | `mutedForeground` on `card`          | 4.5:1 | 4.87:1   | pass |
| light | `mutedForeground` on `muted`         | 4.5:1 | 4.50:1   | pass |
| light | `primaryForeground` on `primary`     | 4.5:1 | 5.17:1   | pass |
| light | `secondaryForeground` on `secondary` | 4.5:1 | 16.69:1  | pass |
| light | `successForeground` on `success`     | 4.5:1 | 5.02:1   | pass |
| light | `infoForeground` on `info`           | 4.5:1 | 5.17:1   | pass |
| light | `dangerForeground` on `danger`       | 4.5:1 | 4.83:1   | pass |
| light | `success` on `background`            | 4.5:1 | 5.02:1   | pass |
| light | `danger` on `background`             | 4.5:1 | 4.83:1   | pass |
| light | `primary` on `background`            | 3:1   | 5.17:1   | pass |
| light | `primary` on `card`                  | 3:1   | 4.83:1   | pass |
| light | `ring` on `background`               | 3:1   | 17.02:1  | pass |
| light | `ring` on `card`                     | 3:1   | 15.91:1  | pass |
| light | `ring` on `muted`                    | 3:1   | 14.71:1  | pass |
| light | `ring` on `secondary`                | 3:1   | 15.11:1  | pass |
| light | `ring` on `primary`                  | 3:1   | 3.29:1   | pass |
| light | `inputBorder` on `background`        | 3:1   | 3.39:1   | pass |
| light | `inputBorder` on `card`              | 3:1   | 3.17:1   | pass |
