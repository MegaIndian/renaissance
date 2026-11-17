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
   saturated colour besides the primary. Placeholder art uses the six `chart` colours in order, and only
   stands in for art that exists: an empty row shows an `EmptyState`, never a grid of coloured squares.
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
   (the focus ring, the primary button, form input borders in `inputBorder`) pass 3:1. Card and row
   hairlines (`border`) are decorative, sit around 1.3:1, and are never the only thing that shows an edge.
   The table under "Measured contrast" is computed from the tokens by `src/contrast.ts`; the test fails
   the build if any pair drops below its line.
7. **The Ask bar is on every screen.** One box, placeholder "Ask for anything", with a `ring` focus halo
   (3 px, 25 % primary), a magnifier glyph and a `⌘K` hint on desktop (`⌘K` or `Ctrl K` focuses it). The
   shell renders it, not the screens: on desktop it is the top bar above the content; on phones it sits
   above the player and the tab bar. Library hits appear instantly under it; the model's answer streams in
   under them as cards with actions and an undo.
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
    the lint fails on them); focus is visible; `tokens.css` turns animation and transitions off under
    `prefers-reduced-motion: reduce`, and mobile reads `AccessibilityInfo.isReduceMotionEnabled` through
    `useReducedMotion` and gets zero durations from the theme; type scales with the system setting.

## Simple mode (the default for every profile)

The home screen for Mom and Dad, and the default for everyone until they switch to advanced in Settings.

```
┌────────────────────────────────────────┐
│ Good evening, Sahil                    │  display, 1.25×; morning, afternoon or evening by the clock
│                                        │
│ My songs                               │  heading
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │  square art, 1.25× titles, horizontal scroll
│ └──────┘ └──────┘ └──────┘ └──────┘   │
│                                        │
│ Recently played                        │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│ └──────┘ └──────┘ └──────┘ └──────┘   │
│                                        │
│ Made for you                           │
│ ┌──────┐ ┌──────┐ ┌──────┐            │  mixes, each named in words
│ └──────┘ └──────┘ └──────┘            │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ ○  Ask for anything…            🎤 │ │  Ask bar, ring focus, voice button (shell, every screen)
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ ▣ Drowning · A Boogie         (▶) │ │  now-playing bar, one primary button
│ └────────────────────────────────────┘ │
│  Home        Library       Requests    │  three tabs, no Search tab (the Ask bar is the search)
└────────────────────────────────────────┘
```

Three rows, nothing else: no genres, no sort menus, no settings on the home screen. Signed out, each row
is one `EmptyState` card with a full sentence, and the one primary on the screen is **Sign in**.
Settings is reached from the avatar (the person glyph at the top right on phones, in the sidebar on
desktop).

### Simple versus advanced

The switch is `Account.mode` in `packages/core/src/models.ts` (`'simple' | 'advanced'`, default
`'simple'`), shown in Settings as a `SegmentedControl` labelled with `settings.mode` (`Simple | Advanced`,
keys `settings.modeSimple` and `settings.modeAdvanced`). The web sets `data-mode` on the root element;
mobile multiplies sizes by `simpleModeScale` in `useTheme`.

|            | Simple (default)                                                 | Advanced                                                     |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| Type       | 1.25× every size and spacing step                                | 1×                                                           |
| Home       | Greeting and three rows: My songs, Recently played, Made for you | The same rows plus Recently added, genres and the full queue |
| Navigation | Home, Library, Requests (phone tabs or desktop sidebar)          | Adds Search as a tab, grid and list views, sort and filter   |
| Ask bar    | Yes, every screen                                                | Yes, every screen                                            |
| Settings   | From the avatar                                                  | From the avatar, plus diagnostics                            |

## Components, mirrored on web and mobile

Same names on both platforms so a contributor who built one knows what to build on the other:
`AskBar`, `TrackRow`, `AlbumCard`, `MixCard`, `NowPlayingBar`, `NowPlayingScreen`, `SegmentedControl`,
`RequestCard`, `Sidebar` (web, desktop), `TabBar` (web under 768 px, and mobile), `EmptyState`,
`PlaceholderArt`.

## Tokens

| Group                     | Values                                                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colours (dark)            | background `#0f0f14`, foreground `#e8e8ee`, card `#17171e`, border `#2a2a35`, inputBorder `#6a6a80`, muted `#22222c`, mutedForeground `#9a9aae`, primary `#2f6fe0` on primaryForeground `#ffffff`, secondary `#1f1f28`, success `#22c55e` on `#0f0f14`, danger `#f87171` on `#0f0f14` |
| Colours (light)           | background `#ffffff`, foreground `#111118`, card `#f7f7f9`, border `#e3e3e9`, inputBorder `#8a8a9c`, muted `#eeeef2`, mutedForeground `#6b6b7e`, primary `#2563eb` on `#ffffff`, secondary `#f1f1f5`, success `#15803d` on `#ffffff`, danger `#dc2626` on `#ffffff`                   |
| Chart and placeholder art | `#3b82f6` `#14b8a6` `#f59e0b` `#a78bfa` `#f87171` `#a3e635`                                                                                                                                                                                                                           |
| Radius                    | sm 8, md 10, lg 16, pill 999 (px; radii do not scale)                                                                                                                                                                                                                                 |
| Spacing                   | 4-point grid: 4, 8, 12, 16, 20, 24, 32, 40, 48 px, emitted as `--space-N` in rem                                                                                                                                                                                                      |
| Type                      | caption 11/14, body 13/18, label 12/16, title 15/20, heading 18/24, display 24/30 (size/line height, px at a 16 px root, emitted as `--font-size-*` and `--line-height-*` in rem); simple mode ×1.25 on the root                                                                      |
| Shadows                   | low `0 1px 2px rgba(0,0,0,.15)` (segmented pill), art `0 8px 24px rgba(0,0,0,.25)` (now-playing art); nothing else                                                                                                                                                                    |
| Motion                    | fast 120 ms, normal 200 ms, slow 320 ms, easing `cubic-bezier(0.2, 0, 0, 1)`; all off under reduced motion                                                                                                                                                                            |
| Breakpoints               | tablet 768, desktop 1024                                                                                                                                                                                                                                                              |

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
| dark  | `ring` on `background`               | 3:1   | 4.07:1   | pass |
| dark  | `ring` on `card`                     | 3:1   | 3.80:1   | pass |
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
| light | `ring` on `background`               | 3:1   | 5.17:1   | pass |
| light | `ring` on `card`                     | 3:1   | 4.83:1   | pass |
| light | `inputBorder` on `background`        | 3:1   | 3.39:1   | pass |
| light | `inputBorder` on `card`              | 3:1   | 3.17:1   | pass |
