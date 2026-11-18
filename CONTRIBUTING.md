# Contributing to Renaissance

Thank you. This page gets you from clone to a merged pull request.

## Setup in ten minutes

1. Node 22.18 or later (`.nvmrc`), Git, and pnpm 12: `npm i -g pnpm@12` (on Node 22, `corepack enable` also
   works; Node 24 and later ship without corepack). For mobile: Xcode 16+ or Android Studio,
   or the Expo Go app.
2. `git clone https://github.com/MegaIndian/renaissance && cd renaissance && pnpm install`
3. `pnpm dev` starts the web app and the hub. `pnpm --filter mobile start` starts Expo.
4. Optional, needs Docker: `node docker/demo/start.mjs` downloads four Creative Commons tracks
   (about 20 MB, once), starts Jellyfin 10.10 on http://localhost:8096, completes its setup wizard
   through the API, creates the user `demo` with a random password, adds the `Music` library at
   `/media/music`, starts a scan, and prints the address, user and password. The password is also
   written to `docker/demo/config/demo-credentials.json` (ignored by Git) so the e2e suite and later
   runs can read it. Run `node docker/demo/start.mjs down` to stop it; `--dry-run` prints the API
   calls without touching Docker.

## Where things go

- A feature is written once in `packages/core` and skinned twice (`apps/web`, `apps/mobile`). If you add a
  screen on one platform, open an issue for the other with the same component name.
- Colours, radii, type sizes and spacing come from `packages/design`; nothing else defines them. Read
  `packages/design/DESIGN.md` before touching a screen.
- Server-side code lives in `apps/hub`. Keys live in the hub's environment, never in the apps or the repo.
- User-facing strings go in `packages/core/src/i18n/locales/en.json` and `gu.json`, both, in the same
  change. Tests fail when the key sets differ.

## Picking an issue

Issues labelled `good first issue` are scoped and explained. Comment that you are taking it; a maintainer
assigns it. Each feature issue names its F-number from `docs/ROADMAP.md` and has a web and a mobile
checkbox.

## Pull requests

- Every change reaches `main` through a pull request, including the maintainer's own: `main`
  requires a PR, a green CI run, resolved conversations and a linear history, and the rules apply to
  administrators too.
- Branch from `main`; conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`),
  enforced by commitlint. Scope by package when it helps: `feat(web): ...`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` green locally. CI runs the same plus `pnpm audit`
  at the high level, the web and hub builds, the web browser tests (`pnpm --filter web e2e`, Playwright
  on Chromium: focus outline and control sizes measured on the built app), the hub container image and
  a smoke test of `/health` that checks the reported version. Coverage on `packages/core` and
  `apps/hub` must stay at 80 % or more (the test command fails under it).
- Screens: no literal strings in JSX and no arbitrary Tailwind values (`text-[13px]`); the lint
  fails on both. Strings are catalog keys; sizes are token utilities (`text-body`, `p-4`).
- Add a changeset (`pnpm changeset`) for anything a user would notice.
- Fill the PR template: what, why, screenshots for any screen change (phone, tablet, desktop), tests.
- What reviews a PR today: CodeQL (GitHub's default setup, actions and JavaScript/TypeScript) on every
  PR, then a maintainer. Answer each comment, fixed or why not. `.coderabbit.yaml` at the root is a
  ready configuration for CodeRabbit; it takes effect only if that app is installed on the repository,
  and it is not installed today.
- Squash merge; the PR title becomes the commit message.
- Releases: merging to `main` runs the Release workflow, which opens or updates the Changesets version
  PR (`chore(release): version packages`, branch `changeset-release/main`). GitHub holds that PR's CI
  run for approval because its author is `github-actions[bot]`, and the required `CI` check stays
  missing until a maintainer opens the held run under Actions and presses "Approve and run" (or
  `gh api -X POST repos/MegaIndian/renaissance/actions/runs/<run id>/approve`). One click per version
  PR; a dispatched run on the branch does not count, because GitHub does not list `workflow_dispatch`
  runs on a pull request. Opening the PR with a GitHub App or fine-grained PAT token would remove the
  click; the repository has no such secret today. Merging the version PR writes the package changelogs
  and versions.

## Licence

GPL-3.0-or-later for the whole repository (`LICENSE`, `NOTICE`); there are no per-file headers.
By contributing you agree your contribution is licensed the same way.

## Code of conduct

Everyone here follows the [Code of Conduct](CODE_OF_CONDUCT.md). Reports go through the private
channel it names, never a public issue.
