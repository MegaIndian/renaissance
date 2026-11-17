# Renaissance design

The look is borrowed from T3 Code: flat cards, hairline borders, muted neutrals, one blue primary,
segmented controls, dense but calm type. The reference is `docs/design/mockup-2026-11-17.html`
(iPhone Home, Search with one-tap requests, Now Playing; desktop with sidebar and bottom player). The
Spotify-style gradient look was shown first and declined. Every value below lives in `src/tokens.ts`;
nothing in an app defines its own colour, radius or font size.

## Rules

1. **One primary.** Blue (`primary`) marks the one action that matters on a screen: play, add, sign in.
   Everything else is `secondary` (filled, bordered) or ghost (text only). Never two primaries in view.
2. **Flat cards with hairline borders.** A card is `card` background, 1 px `border`, `radius` 10 px,
   no shadow. The only shadows are the lifted now-playing art and the active pill of a segmented control.
3. **Muted neutrals.** Greys from the token set; no pure black, no pure white text. Cover art is the only
   saturated colour besides the primary. Placeholder art uses the six `chart` colours in order.
4. **Segmented controls, not tabs with underlines.** Filters (`All | Music | Downloaded`) are a pill group
   on a `muted` track with the active segment on `card`.
5. **Compact type, big in simple mode.** Body 13 px, captions 11 px, titles 15 px, headings 18 px. Simple
   mode multiplies every size by 1.25 and never shows more than three rows.
6. **Dark first, light mirrored.** Dark is the reference; the light theme has the same contrast
   relationships. Both must pass WCAG AA for text (4.5:1) and controls (3:1).
7. **The Ask bar is on every screen.** One box, placeholder "Ask for anything", with a `ring` focus halo
   (3 px, 25 % primary). On desktop it sits at the top with a `⌘K` hint; on phones it sits above the tab bar
   on Home and at the top elsewhere. Library hits appear instantly under it; the model's answer streams in
   under them as cards with actions and an undo.
8. **Hairlines between rows, never zebra stripes.** Lists are rows separated by 1 px `border`, 34 px art,
   title in body-strong, subtitle in caption `mutedForeground`.
9. **Progress is quiet.** 3 px bars on `muted`, `info` fill; a request card says what is happening in
   words ("Downloading 14 of 18") and when it will be done.
10. **Every action shows what it did and has an undo.** No silent changes; no confirmation dialogs for
    reversible things.
11. **Gujarati fits.** Strings are longer in Gujarati; every label wraps or truncates with an ellipsis,
    never overflows. Figures and names stay in Latin letters.
12. **Accessible by default.** Every control has a label; focus is visible; motion respects
    reduced-motion; type scales with the system setting.

## Simple mode (the default for every profile)

The home screen for Mom and Dad, and the default for everyone until they switch to advanced in Settings.

```
┌────────────────────────────────────────┐
│ Good evening, Sahil                    │  display, 1.25×
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ ○  Ask for anything…            🎤 │ │  Ask bar, ring focus, voice button
│ └────────────────────────────────────┘ │
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
│ │ ▣ Drowning · A Boogie         (▶) │ │  now-playing card, one primary button
│ └────────────────────────────────────┘ │
│  Home        Library       Requests    │  three tabs, no Search tab (the Ask bar is the search)
└────────────────────────────────────────┘
```

Three rows, nothing else: no genres, no sort menus, no settings on the home screen. Settings is reached
from the avatar. Advanced mode adds the full tab bar (Home, Search, Library, Requests), grid and list
views, sort and filter, and the queue.

## Components, mirrored on web and mobile

Same names on both platforms so a contributor who built one knows what to build on the other:
`AskBar`, `TrackRow`, `AlbumCard`, `MixCard`, `NowPlayingBar`, `NowPlayingScreen`, `SegmentedControl`,
`RequestCard`, `Sidebar` (web), `TabBar` (mobile), `EmptyState`.

## Tokens

| Group                     | Values                                                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colours (dark)            | background `#0f0f14`, foreground `#e8e8ee`, card `#17171e`, border `#2a2a35`, muted `#22222c`, mutedForeground `#9a9aae`, primary `#3b82f6`, secondary `#1f1f28`, success `#22c55e`, danger `#f87171` |
| Chart and placeholder art | `#3b82f6` `#14b8a6` `#f59e0b` `#a78bfa` `#f87171` `#a3e635`                                                                                                                                           |
| Radius                    | sm 8, md 10, lg 16, pill 999                                                                                                                                                                          |
| Spacing                   | 4-point grid: 4, 8, 12, 16, 20, 24, 32, 40, 48                                                                                                                                                        |
| Type                      | caption 11, body 13, label 12, title 15, heading 18, display 24; simple mode ×1.25                                                                                                                    |
| Motion                    | fast 120 ms, normal 200 ms, slow 320 ms, easing `cubic-bezier(0.2, 0, 0, 1)`                                                                                                                          |
| Breakpoints               | tablet 768, desktop 1024                                                                                                                                                                              |

Web consumes `tokens.css` (CSS variables, generated from `tokens.ts` with `pnpm --filter @renaissance/design build:css`) through Tailwind 4's `@theme`. Mobile imports `tokens.ts` directly.
