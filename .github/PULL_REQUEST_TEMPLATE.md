## What

<!-- One paragraph. Reference the roadmap number (F12) and the issue (#34). -->

## Why

<!-- The problem this solves or the decision it follows (ADR number if any). -->

## Screenshots

<!-- Any screen change: phone, tablet and desktop widths, dark and light. Delete if no screen changed. -->

## Tests

<!-- What is covered and how to run it. Core logic needs unit tests; screens need the e2e or a manual script. -->

## Checklist

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass locally
- [ ] Strings added to both `en.json` and `gu.json`
- [ ] Tokens from `packages/design` only; one primary per screen; simple mode checked
- [ ] Hub changes keep the tool-only rule (ADR 0007) and read config from the environment only
- [ ] Changeset added (`pnpm changeset`) if a user would notice
- [ ] Conventional commit title
