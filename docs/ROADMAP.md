# Roadmap

Every feature from the master list, grouped by build phase. Tier: **v1** (first release people can live on), **v1.1** (first follow-up), **later** (designed for, not built). Status moves to `web`, `mobile` or `both` as each lands. The phase loop (build, three judges, rework, merge) is described in the project's build program; phase 0 is this scaffold.

## Phases

### Phase 0: Scaffold

Repo, monorepo, tooling, CI, docs, ADRs, design tokens, demo Jellyfin, i18n skeleton.

| ID  | Feature                                                                                                                                                                                                                                                                                                                                                  | Tier | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| F65 | Design system shared by web and mobile (tokens, components mirrored, DESIGN.md); dark and light; Spotify-grade now-playing and home. Direction set 2026-11-17 by Sahil: take the look from T3 Code (flat cards with 1 px borders, muted greys, one blue primary, segmented controls, ⌘K search, compact type); `mockup-2026-11-17.html` is the reference | v1   | planned |
| F66 | Translations with i18next from day one; English and Gujarati both in v1 (Sahil, 2026-11-17 evening)                                                                                                                                                                                                                                                      | v1   | planned |

### Phase 1: Core + web

ServerAdapter (Jellyfin), models, queue, playback policy, library cache; web: sign in, simple-mode home, Ask bar instant layer, library, album, artist, favorites, playlists, now playing, queue, gapless, media keys, play reporting.

| ID  | Feature                                                                                                                                                                                                                                      | Tier | Status  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| F1  | Sign in to a Jellyfin server by address, user and password                                                                                                                                                                                   | v1   | planned |
| F2  | Quick Connect sign-in (code shown, approved in the Jellyfin web app)                                                                                                                                                                         | v1   | planned |
| F7  | Home: recently added, recently played, most played, favorites, mixes                                                                                                                                                                         | v1   | planned |
| F8  | Artists, album artists, albums, tracks, genres, years; grid and list views                                                                                                                                                                   | v1   | planned |
| F9  | Album page: tracks, disc split, duration, year, genre, label, play, shuffle, download, add to playlist                                                                                                                                       | v1   | planned |
| F10 | Artist page: bio, albums by type (album, EP, single, live, compilation), appears on, similar artists                                                                                                                                         | v1   | planned |
| F11 | Search across artists, albums, tracks, playlists with instant results and recent searches; the instant layer under the Ask bar (F75)                                                                                                         | v1   | planned |
| F12 | Favorites (heart) on tracks, albums, artists, synced with Jellyfin                                                                                                                                                                           | v1   | planned |
| F13 | Playlists: create, rename, reorder, add, remove, delete, synced with Jellyfin                                                                                                                                                                | v1   | planned |
| F14 | Local library cache in SQLite (mobile) and IndexedDB (web) with delta refresh, so browsing is instant and works offline                                                                                                                      | v1   | planned |
| F15 | Sort and filter everywhere (name, date added, year, play count, random; downloaded only)                                                                                                                                                     | v1   | planned |
| F20 | Direct play of FLAC, MP3, AAC, ALAC, Opus, Vorbis; transcoding through Jellyfin's universal endpoint when the device cannot                                                                                                                  | v1   | planned |
| F21 | Gapless playback (next track preloaded, zero gap between album tracks)                                                                                                                                                                       | v1   | planned |
| F22 | Queue: up next, drag to reorder, play next, add to end, clear, history, persistent across restarts                                                                                                                                           | v1   | planned |
| F23 | Shuffle (album-aware option) and repeat (off, all, one)                                                                                                                                                                                      | v1   | planned |
| F24 | Now-playing screen: artwork, scrubber with chapter-free seek, lyrics button, queue button, cast button                                                                                                                                       | v1   | planned |
| F25 | Lock-screen and notification controls, headphone buttons, media keys on desktop (MediaSession, RNTP)                                                                                                                                         | v1   | planned |
| F26 | Play state reported to Jellyfin (start, progress, stop) so play counts and continue-listening work across apps                                                                                                                               | v1   | planned |
| F27 | Streaming quality per network: Wi-Fi lossless, cellular capped bitrate, per-server setting                                                                                                                                                   | v1   | planned |
| F75 | Ask bar on every screen: type or speak anything in any language (English, Gujarati script or Latin letters); library hits appear instantly, the model's answer streams under them as cards with actions and undo; voice on phone and CarPlay | v1   | planned |
| F84 | Simple mode: big-type home with the Ask bar and three rows (my songs, recent, mixes); the default for every profile, advanced mode is a switch in Settings (Sahil, 2026-11-17 evening)                                                       | v1   | planned |

### Phase 2: Hub v0

Catalogue client, fetch pipeline, Requests tab, intent engine with the fixed tool set, household rules, budget meter.

| ID  | Feature                                                                                                                                                                                                                                                                                                                                                                                                                  | Tier | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------- |
| F61 | One search box: catalogue typeahead (songs, artists, albums, art, previews) with library hits first; tap a song or album to add it; the server-side fetch service finds it on Soulseek (cleaned queries, deterministic ranking, Claude pick only when ambiguous), downloads, imports with explicit track mapping, scans the library and pushes "Ready". The user never sees Lidarr or slskd. Design in plan.md, Requests | v1   | planned |
| F62 | Missing tracks from an import requested in Lidarr in one tap                                                                                                                                                                                                                                                                                                                                                             | v1   | planned |
| F63 | Requests tab: requested, finding, downloading, ready, with progress; moved to v1 on 2026-11-17 because the one-box search (F61) needs somewhere to show what is on its way                                                                                                                                                                                                                                               | v1   | planned |
| F76 | Intent engine on the hub: Claude tool use with a fixed tool set (search_library, lookup_catalogue, play, queue, make_playlist, request, set_rule, explain), strict JSON, one call per utterance, cached system prompt; the model can only act on data a tool returned                                                                                                                                                    | v1   | planned |
| F80 | Household rules and memory in plain words ("no live versions", "Dad likes the 80s Bollywood ones"), per user, applied by the fetch service and the mixes                                                                                                                                                                                                                                                                 | v1   | planned |

### Phase 3: Mobile + audio

Expo app with the same screens; RNTP; native EQ, ReplayGain, crossfade; voice on the Ask bar.

| ID  | Feature                                                                                                    | Tier | Status  |
| --- | ---------------------------------------------------------------------------------------------------------- | ---- | ------- |
| F30 | ReplayGain loudness leveling (track and album modes, from tags; fallback to Jellyfin's normalization gain) | v1   | planned |
| F31 | Ten-band equalizer with presets and per-output-device memory                                               | v1   | planned |
| F32 | Crossfade (0 to 12 s) with album-aware off switch so gapless albums stay gapless                           | v1   | planned |

### Phase 4: Enrichment + discovery

Batch tagging on Haiku, mixes from tags and history, time-of-day mix, weekly new-for-you, listening log.

| ID  | Feature                                                                                                                                                                                                                        | Tier | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------- |
| F42 | Daily mixes: up to six, built from listening history plus the enrichment tags (F77), each named and described in words, refreshed daily                                                                                        | v1   | planned |
| F43 | Artist radio and song radio (Jellyfin InstantMix plus local scoring)                                                                                                                                                           | v1   | planned |
| F44 | Because you listened to X (Jellyfin Similar items weighted by recent plays)                                                                                                                                                    | v1   | planned |
| F45 | Rediscover: loved or heavily played a year ago, quiet since                                                                                                                                                                    | v1   | planned |
| F46 | New in your library, grouped by week                                                                                                                                                                                           | v1   | planned |
| F47 | Local listening log (every play, device, time, skip) kept on device and optionally synced to the server as a playlist-free history                                                                                             | v1   | planned |
| F77 | Library enrichment: each track tagged once for mood, energy, era, language, vocal or instrumental, explicit, from metadata and lyrics through the Batch API on Haiku; stored in the hub database; new tracks tagged on arrival | v1   | planned |
| F78 | Mixes from enrichment plus history: time-of-day mix, weekly "new for you" that includes songs not in the library with one-tap adds                                                                                             | v1   | planned |

### Phase 5: Offline

Downloads, quality, Wi-Fi only, offline mode, OPFS on web.

| ID  | Feature                                                                                                                   | Tier | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| F34 | Download albums, playlists, artists and single tracks for offline play; progress, pause, resume, retry                    | v1   | planned |
| F35 | Download quality setting (original or transcoded cap), Wi-Fi-only switch, storage used and a clear-all                    | v1   | planned |
| F36 | Offline mode: automatic when the server is unreachable, manual toggle; library browsing of downloaded items works offline | v1   | planned |
| F38 | Web: downloads to browser storage (OPFS) with quota display; desktop shell later gets real files                          | v1   | planned |

### Phase 6: Servers + lyrics

Several servers and accounts, discovery, keychain; synced and unsynced lyrics.

| ID  | Feature                                                                                                                 | Tier | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| F3  | Several servers and accounts saved, switch in two taps, each with its own cache and downloads                           | v1   | planned |
| F4  | Server discovery on the LAN (Jellyfin UDP broadcast) and Tailscale/https addresses accepted                             | v1   | planned |
| F5  | Tokens in the platform keychain (Keychain, Keystore, OS credential store); never in plain files                         | v1   | planned |
| F39 | Synced lyrics from Jellyfin's Lyrics API (.lrc files or the server's LrcLib plugin), karaoke scroll, tap a line to seek | v1   | planned |
| F40 | Unsynced lyrics shown as text when no timings exist                                                                     | v1   | planned |

### Phase 7: Import

Exportify CSV, screenshots and photos, links, text.

| ID  | Feature                                                                                                                                                                                               | Tier | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| F58 | Spotify playlist import from an Exportify CSV: match by artist, title and duration; matched tracks become a Jellyfin playlist; missing ones become requests (see F79 for screenshots, links and text) | v1   | planned |
| F79 | Import from anything: screenshot or photo of a playlist or CD shelf, pasted text, public Spotify or Apple Music link; matched songs become a playlist, gaps become requests                           | v1   | planned |

### Phase 8: Car, cast, watch

AirPlay, Chromecast, CarPlay, Android Auto, Watch remote.

| ID  | Feature                                                                                                  | Tier | Status  |
| --- | -------------------------------------------------------------------------------------------------------- | ---- | ------- |
| F50 | AirPlay from iPhone, iPad and Mac (system route picker)                                                  | v1   | planned |
| F51 | Chromecast from mobile and web (Cast SDK; direct stream URLs to the default receiver)                    | v1   | planned |
| F52 | CarPlay: now playing, library (artists, albums, playlists), mixes, voice through Siri where Apple allows | v1   | planned |
| F53 | Android Auto equivalent via RNTP's media browser                                                         | v1   | planned |
| F54 | Apple Watch companion: now-playing remote, play/pause, skip, volume, like                                | v1   | planned |

### Phase 9: Release

Accessibility pass, Gujarati complete, settings, diagnostics, README, TestFlight, APK, store listings.

| ID  | Feature                                                                                                | Tier | Status  |
| --- | ------------------------------------------------------------------------------------------------------ | ---- | ------- |
| F67 | Settings: playback, audio, downloads, network, servers, appearance, about, diagnostics (log export)    | v1   | planned |
| F68 | Accessibility: screen reader labels, dynamic type, reduced motion, keyboard navigation on desktop      | v1   | planned |
| F70 | Installers in GitHub releases (APK, IPA via TestFlight, web build); App Store and Google Play listings | v1.1 | planned |

## After 1.0: v1.1 items

| ID  | Feature                                                                                                           | Tier | Status  |
| --- | ----------------------------------------------------------------------------------------------------------------- | ---- | ------- |
| F16 | Multi-select and bulk actions (add to playlist, download, favorite)                                               | v1.1 | planned |
| F17 | Smart playlists with rules (genre, year, play count, last played, rating) saved in the app                        | v1.1 | planned |
| F28 | Sleep timer                                                                                                       | v1.1 | planned |
| F37 | Keep-synced playlists: a playlist marked for download stays updated when it changes on the server                 | v1.1 | planned |
| F41 | Lyrics fetch from the app (LrcLib) when the server has none, with a save-to-server option for admins              | v1.1 | planned |
| F48 | Year in review (top artists, albums, minutes)                                                                     | v1.1 | planned |
| F59 | Spotify sign-in import (PKCE, user-supplied client id) for playlists, liked songs and followed artists            | v1.1 | planned |
| F60 | Scrobbling to Last.fm and ListenBrainz from the app                                                               | v1.1 | planned |
| F69 | Desktop shell for the web app (Tauri): tray, media keys, autostart, real file downloads                           | v1.1 | planned |
| F71 | Crash and error reporting opt-in (Sentry, self-hostable GlitchTip)                                                | v1.1 | planned |
| F81 | Explain: "tell me about this album" from MusicBrainz and Wikipedia fetched by the hub and summarised with sources | v1.1 | planned |
| F82 | Release watch: new releases from artists you play, via MusicBrainz, as a short digest with one-tap adds           | v1.1 | planned |
| F83 | Library care: duplicates and bad tags found, fixes proposed, applied on a tap                                     | v1.1 | planned |

## Later and out of scope

| ID  | Feature                                                                                | Tier        | Status                           |
| --- | -------------------------------------------------------------------------------------- | ----------- | -------------------------------- |
| F6  | Subsonic/OpenSubsonic adapter behind the same server interface (Navidrome, Gonic, LMS) | later       | planned                          |
| F18 | Track ratings (stars) stored on Jellyfin                                               | later       | planned                          |
| F19 | Tag and metadata editing through Jellyfin for admins                                   | later       | planned                          |
| F29 | Playback speed for talk content                                                        | later       | planned                          |
| F33 | Bit-perfect/exclusive output option on desktop                                         | later       | planned                          |
| F49 | ListenBrainz recommendations as a mix source                                           | later       | planned                          |
| F55 | Apple Watch standalone playback with downloads                                         | later       | planned                          |
| F56 | Wear OS companion                                                                      | later       | planned                          |
| F57 | Jellyfin remote control: play on another Jellyfin client (TV, another phone)           | later       | planned                          |
| F64 | Apple Music and YouTube Music playlist CSV import                                      | later       | planned                          |
| F72 | Podcasts and audiobooks                                                                | not planned | out of scope (Sahil, 2026-11-17) |
| F73 | Multi-user profiles on one device (family phone)                                       | later       | planned                          |
| F74 | Plugin or theme API                                                                    | later       | planned                          |
| F85 | Talking DJ (short spoken intros between songs)                                         | later       | planned                          |
