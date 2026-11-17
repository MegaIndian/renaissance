# Demo Jellyfin

A Jellyfin container with four Creative Commons tracks (Kevin MacLeod, CC BY 4.0; see `music/LICENSE.md`)
for e2e tests and for contributors without a library.

```sh
node docker/demo/start.mjs        # downloads the tracks once, starts Jellyfin on http://localhost:8096
node docker/demo/start.mjs down   # stops it
```

First run: open http://localhost:8096, finish the wizard, create a user, add a Music library pointing at
`/media/music`. Later phases automate this setup for the e2e suite. The audio files and the Jellyfin
`config/` folder are ignored by Git.
