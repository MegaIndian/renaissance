# ADR 0011: The token travels in stream, download and websocket URLs

Date: 2026-11-18. Status: accepted. Adds to ADR 0008, which it does not change.

## Context

ADR 0008 says image URLs carry no token (Jellyfin serves images anonymously, so the browser can cache
them). It did not say where the token does travel in a URL. Three places do: the universal audio stream
(`/Audio/{id}/universal?api_key=`), the download link (`/Items/{id}/Download?api_key=`) and the
websocket (`/socket?api_key=`). A URL lands in the reverse proxy's access log and, for a slow request,
in Jellyfin's own log, where the token can be read by whoever reads those logs.

## Decision

1. The token stays in those three URLs. A media element and a `WebSocket` cannot send an
   `Authorization` header, and Jellyfin offers no other way to authenticate them; its own web client
   does the same.
2. The mitigation is the one Jellyfin allows. It has no short-lived tokens, so the app makes the
   lifetime short by hand: signing out calls `POST /Sessions/Logout`, which revokes the token on the
   server, and a token the server has revoked (a 401 to any request that carried it) ends the session
   in the app at once and sends the person to sign-in with a sentence saying why.
3. Signing out also deletes this person's library database and saved queue from the browser, so a
   shared computer keeps nothing of them (ADR 0008 §4 said "clears"; this is what it means).
4. Nothing else carries the token in a URL: images stay anonymous, and every other call sends the
   `MediaBrowser` header.

## Consequences

- An administrator who reads proxy logs can see a household member's token while it is valid, as with
  every Jellyfin client. Signing out, or the administrator deleting the device in Jellyfin, ends that.
- When Jellyfin adds short-lived or scoped tokens, the adapter can switch the three URLs to them
  without touching a screen.
