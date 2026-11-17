# ADR 0001: One monorepo, two apps, one core

Date: 2026-11-17. Status: accepted.

## Context

Renaissance must run as a web app on desktops and as a native app on iPhone, iPad and Android. A single
Flutter codebase was proposed and declined; Sahil chose the SparkyFitness pattern after seeing it work
there: a React web app plus a React Native (Expo) app. The known cost of that pattern is drift: features
land on one platform and not the other.

## Decision

A pnpm + Turborepo monorepo with `apps/web`, `apps/mobile`, `apps/hub` and `packages/core`,
`packages/design`. Everything that is not a screen lives in `packages/core` as framework-free TypeScript
tested with Vitest: server adapters, models, queue, playback policy, mix engine, import matcher, offline
manifest logic, settings schema and the i18n catalogs. Screens are thin and built twice with mirrored
component names. TypeScript strict everywhere; Node 22; one ESLint, Prettier and tsconfig base.

## Consequences

- Each feature is written once and skinned twice; the skin is small.
- Every feature issue has a web and a mobile checkbox; the roadmap marks `web`, `mobile` or `both`.
- Contributors need one language. Core changes are reviewed on their tests, not on screenshots.
- Mobile typechecks in CI without EAS or native builds; native builds happen locally and, later, on EAS.
