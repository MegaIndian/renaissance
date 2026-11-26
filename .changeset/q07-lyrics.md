---
'web': minor
'@renaissance/core': minor
---

Lyrics (F39, F40). The Lyrics button on the now-playing screen opens the song's lyrics from Jellyfin's lyrics API (`.lrc` or `.txt` files beside the song, or the server's LrcLib plugin). Synced lyrics highlight the line being sung and keep it in the middle of the screen; scrolling pauses that for a few seconds, and "Back to the current line" returns at once. A tap, a click or Enter on a line plays from it; the list is one tab stop with the arrow keys, Home and End, and reduced motion jumps instead of gliding. Lyrics without timings show as plain verses, and a song without lyrics says so. Core gains an LRC parser (several time tags per line, `[offset:]`, word timings ignored) that also reads an `.lrc` file Jellyfin's own parser gave up on. The demo setup adds a synced and a plain lyrics file to two demo songs.
