# ADR 0005: Mixes are pure functions in core over three inputs

Date: 2026-11-17. Status: accepted.

## Context

Daily mixes, radios, rediscover and new-in-library (F42 to F47) must behave the same on web and mobile, be
testable without a server, and later use the hub's enrichment tags (F77) and household rules (F80).

## Decision

The mix engine lives in `packages/core` as pure functions over three inputs: the local `ListenEvent` log
(track, time, completed or skipped, device), the server's user data (play counts, favorites, last played)
and adapter signals (`Similar`, `InstantMix`, genres), plus, from phase 4, the hub's enrichment tags.
Output is `MixDefinition`s (title, reason text in words, track ids, seed images, built-for date) cached for
the day. Daily mixes weight recency-decayed plays, cluster by genre and artist adjacency, take the top six
clusters, 50 tracks each, 60 % known favorites and 40 % Similar or InstantMix results not played in 30 days.
Properties hold for every mix: no track twice, no artist more than three times in a row, length bounds.

## Consequences

- Fixtures of fake logs produce stable mixes; properties are tested, not screenshots.
- The time-of-day mix and weekly "new for you" (F78) are more functions with the same inputs plus the hub's
  catalogue results for songs not yet in the library.
- ListenBrainz (F49) is one more signal later, not a redesign.
