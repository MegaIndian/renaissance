# ADR 0002: Jellyfin first, behind a ServerAdapter interface

Date: 2026-11-17. Status: accepted.

## Context

Jellyfin already runs for the family with their accounts. Navidrome (Subsonic API) also runs on the same
server as the interim player while Renaissance is built. Supporting both from day one doubles the work in
phase 1.

## Decision

v1 targets Jellyfin 10.10 or later only, through the `ServerAdapter` interface in `packages/core`
(`signIn`, `library`, `streamUrl`, `downloadUrl`, `imageUrl`, `lyrics`, `reportPlayback`). `JellyfinAdapter`
is the only implementation in v1. A Subsonic/OpenSubsonic adapter (F6) can be added without touching any
screen; it is the first v1.1 contribution we will ask for. The open question of switching to Navidrome's
API (plan.md, decision F) is answered by this interface: either or both can be served.

## Consequences

- Screens never import Jellyfin types; they see core models (`Track`, `Album`, ...).
- The adapter owns URL building, auth headers and the API map in plan.md; it is tested with URL assertions
  in phase 0 and against the demo Jellyfin container from phase 1.
- Multiple servers and accounts (F3) are a list of adapters, each with its own cache and downloads.
