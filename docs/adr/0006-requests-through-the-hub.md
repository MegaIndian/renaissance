# ADR 0006: Requests go through the hub, never through Lidarr or slskd in the apps

Date: 2026-11-17. Status: accepted. Supersedes the earlier "Lidarr key in the app" design.

## Context

Mom and Dad will never open Lidarr or slskd. Lidarr sends no CORS headers, so the web app cannot call it
from another origin. Lidarr's own edition matching fought back on real albums; explicit track mapping
fixed them by hand.

## Decision

The apps show one search box with catalogue typeahead (MusicBrainz first, Deezer's public search for art
and previews) with library hits first. A tap sends the catalogue entry (artist, title, album, duration,
MusicBrainz ids) to the hub's `/requests`. The hub owns the chain: cleaned slskd queries, deterministic
ranking (duration within 3 s, lossless or 320 kbps, free slot, not karaoke or live or sped up unless asked),
one model call to pick only when the top candidates are ambiguous, download, a `ManualImport` into Lidarr
with explicit track ids, a library scan, and a push to the apps. Albums go through Lidarr and soularr;
singles the hub downloads directly. The hub is the only process with Lidarr, slskd and Anthropic keys; the
apps hold the hub address and a sign-in.

## Consequences

- No LLM typeahead: it would be slow, cost per letter and invent names.
- The Requests tab (F63) is the hub's request list: requested, finding, downloading, ready, failed.
- The hub runs as a container next to Jellyfin; its keys are environment variables of that container.
