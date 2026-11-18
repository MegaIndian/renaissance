---
'hub': minor
'@renaissance/core': minor
'web': minor
---

Phase 2, hub v0 (F61, F62, F63, F76, F80, F86, F87): the household database (profiles, per-profile
collection, requests, rules, usage), the catalogue typeahead (MusicBrainz and Deezer, shown as rows
with art, Add and Play as the user types, and returned with every Ask answer so adding works with the
model off),
the fetch pipeline (slskd search with cleaned queries and the Lil alternative, deterministic ranking
that reads household rules, download, explicit track mapping and Lidarr ManualImport, library scans,
statuses with plain-language reasons and a `cancelled` status, progress in words, an album deadline,
albums through Lidarr without touching existing artists), requests scoped to the requester with an
admin whole-house view, the "already on the server" instant add and a duplicate guard, Server-Sent
Events, the intent engine on claude-opus-5-5 with the eight strict tools and the never-invent check,
the budget meter with reservations, a `hubClient` in core, the web Requests tab, "My music" and Ask
bar answers, and a published container image (`ghcr.io/megaindian/renaissance-hub`).
