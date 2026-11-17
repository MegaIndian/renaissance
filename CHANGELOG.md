# Changelog

Versions are managed by [Changesets](https://github.com/changesets/changesets). Changesets writes one
changelog per package when a version PR is merged; this file only points at them.

- [web](apps/web/CHANGELOG.md): the web app
- [mobile](apps/mobile/CHANGELOG.md): the Expo app
- [hub](apps/hub/CHANGELOG.md): the server-side process
- [@renaissance/core](packages/core/CHANGELOG.md): models, adapters, queue, i18n
- [@renaissance/design](packages/design/CHANGELOG.md): tokens and DESIGN.md

Each file appears with the first version PR that touches that package. Pending entries live in
`.changeset/` until then. GitHub releases (`v*` and `phase-*` tags) carry generated notes and the web
build.
