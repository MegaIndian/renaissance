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

Round 2 rework: the hub's CORS preflight allows DELETE, so Cancel and every Undo work from a
browser (tested with Playwright against the real hub); catalogue rows are ranked and pruned to the
words typed (the exact title and artist first; a sentence such as "play something calm for cooking"
shows no rows to add); the model-off answer and the typeahead never offer junk; a request someone
else already made answers "already on its way, asked by Mom" with no undo and makes the second
asker a watcher who gets Ready and the item too; the request card shows the song that will actually
arrive when the catalogue corrected the words; cancels are conditional and answer truthfully (too
late, already finished, or already cancelled); an album cancelled while Lidarr was adding it is
unmonitored; the album deadline runs from the latest retry; the album poll files what soularr fetched
but Lidarr refused; the song lookup never settles for a live take or a remix of a plain title and
keeps the caller's duration; a "no live versions" rule sees the folder name; Deezer quota errors
are never cached and Deezer calls are spaced; the pipeline's lookups are never refused as busy;
`/health` reports the database and degrades when it refuses writes; the Add outcome sits on its own
line under the title with truthful undo-failure wording; one primary Add per panel; broken cover art
falls back to the placeholder; "What happened" is advanced mode only and says its lines are
English in Gujarati; six Gujarati sentences reworded as a speaker would say them.

Round 3 rework: an Enter on "fireman lil wayne" shows Lil Wayne's Fireman first and leaves the
typeahead as it was (the full search asks MusicBrainz fielded for every title-and-artist split,
keeps the Deezer rows MusicBrainz missed, prunes before it cuts the list, and the two caches are
kept apart); tribute acts, karaoke, live takes and remixes rank under the plain song unless asked
for, and a second fielded Deezer call finds the original when the first list had only versions
("Rolling in the Deep Adele", "Halo Beyonce"); the album poll never fails a request from soularr's
parked folders (a sibling album's folder, a wrong match in a folder of the right name, or files
that match no track keep the request waiting for the deadline), never replaces a track that already
has a file, hands a file to Lidarr once and says what Lidarr kept, lists the failed-imports folder
once per tick for every waiting album, keeps numeric song titles ("22", "1999"), and shows the true
total from the first minute; the album deadline runs from a stored retry time; credits keep their
join phrases ("Lil Wayne feat. Static Major"); the request card keeps the album asked for and says
on its own wrapped line which release the file will land on; a watched request says who asked in
every scope and offers no Cancel or Retry; retries reach watchers' streams; "Undoing…" while an undo
is in flight; the art placeholder stays under a picture until it loads; Enter aborts the pending
typeahead; the typeahead answers 503 busy when the Deezer limiter refuses; a hub whose database
cannot be used at start stays up answering 503 with the reason on `/health`.
