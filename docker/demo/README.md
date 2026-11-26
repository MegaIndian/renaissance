# Demo Jellyfin

A Jellyfin container with four Creative Commons tracks (Kevin MacLeod, CC BY 4.0; see `music/LICENSE.md`)
for e2e tests and for contributors without a library.

```sh
node docker/demo/start.mjs            # downloads the tracks once, starts Jellyfin on http://localhost:8096,
                                      # completes the wizard, creates user "demo", adds the Music library,
                                      # starts a scan, prints the address and the password
node docker/demo/start.mjs down       # stops it (config and music stay)
node docker/demo/start.mjs --dry-run  # prints the API sequence against a fake server; no Docker needed
```

What the script does after `docker compose up -d`, through the Jellyfin 10.10 API
(`jellyfin-setup.mjs`, unit-tested with a fake server in `jellyfin-setup.test.mjs`):

1. Polls `GET /System/Info/Public` until the server answers.
2. If the wizard is not complete: `POST /Startup/Configuration`, `GET` then `POST /Startup/User`
   (user `demo`, a random 24-character password), `POST /Startup/RemoteAccess`, `POST /Startup/Complete`.
3. `POST /Users/AuthenticateByName` for a token.
4. `GET /Library/VirtualFolders`; if there is no music library, `POST /Library/VirtualFolders` for
   `Music` at `/media/music`; then `POST /Library/Refresh`.
5. Lyrics (F39, F40): `music/Kevin MacLeod - Carefree.lrc` (synced) and
   `music/Kevin MacLeod - Fluffing a Duck.txt` (plain text) are committed beside the songs they belong
   to, so the first scan reads them. On a re-run, `GET /Items` finds those two songs and
   `POST /Items/{id}/Refresh` (full refresh, images and existing metadata kept) makes Jellyfin read
   files added after the song was scanned. The words were written for the demo; the tracks are
   instrumental.
6. Writes `config/demo-credentials.json` (mode 600, ignored by Git) and prints the credentials.

Running it again is safe: the saved password is reused, the wizard and library steps are skipped, and
only a scan and the two lyrics refreshes are triggered. If the server was set up by hand before this
script existed, it says so and leaves it alone. The audio files and the Jellyfin `config/` folder are ignored by Git.
