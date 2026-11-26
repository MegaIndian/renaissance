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

Round 4 rework: the first row for a plain title is the song people mean. Titles are compared with
their edition tags stripped and must cover the words typed ("hotel california" leads with the
Eagles, "a milli lil wayne" with Lil Wayne's album version), the full search keeps the best
MusicBrainz recording of a title rather than the first (Tha Carter II and Tha Carter III, never a
clean edit on a compilation), a live, tour, session or compilation album demotes a row the way a
version word does, two Deezer editions of one song keep the studio one, the release a row names is
the earliest official studio album or single, rows by other artists whose title only names the
asked artist go once the song by the artist is in the list, "(main)", "(a cappella)" and "(Clean)"
rank as versions, a recording MusicBrainz notes "explicit" or "album version" is the plain one
(so Tha Carter III and I Am… Sasha Fierce beat a note-less copy on a compilation), a stray fuzzy
word in a long artist name no longer lifts a row over Deezer's first, when MusicBrainz finds the
original after the typeahead had to show tribute acts the open panel receives it over the event
stream, and when MusicBrainz is over its share past the client's retries Enter answers with the
typeahead rows rather than none. One uploader can no longer fail a request:
after a transfer that ends without the file every other file from that user is skipped, the three
attempts come from distinct users, a username that is a web address ranks under every plain one,
and the failed transfer is removed from slskd. "06 - 22 (Taylor's Version)" files as "22", a
decorated title ("🔥 Fireman 🔥") still resolves, a busy MusicBrainz fails the request with a
"try again in a minute" reason, "play that funky music" finds Wild Cherry first, and a request the
rows already answer shows no "smart answers are off" line. On phones the version named in brackets
moves into the row's subtitle before the artist, so five Firemans can be told apart. The parked
files handed to Lidarr are kept on the request across restarts, a disc subfolder inside the album
folder is the album's, and the minute tick never overlaps itself.

Round 5 rework: the busy-catalogue seam. A MusicBrainz 503 on the album half of a search no longer
throws the songs away; when MusicBrainz is busy and the Deezer rows hold only other versions, the
answer says so (`busy`, `exact: false`), the app offers no primary Add and shows "The catalogue is
busy, these are other versions", the typeahead marks the rows it could not improve and retries the
full search once the minute is up, and a request whose lookup met the 503 is retried by the hub
itself three times a minute apart before it asks for a tap. A song row is paired with the recording
on its own album (a plain "Fireman" never carries the chopped-and-screwed recording's ids), a row
whose album is a compilation is filed under the studio album (Billie Jean under Thriller, never
"The 80s, Part 2"), "Lil Wayne feat. Static Major" is Lil Wayne's row, a soundtrack that is the
recording's earliest release is the record the song was made for, the lookup reads a hundred
recordings, a typo with two letters swapped matches and MusicBrainz is asked again with Deezer's
spelling, the two-lookup merge is cut to size, albums that only name the asked artist go with their
artists, coverage is counted on the title and artist, film tags are edition tags, karaoke and
workout series names demote a row, and catalogue events reach the typist alone. A Jellyfin failure
costs the typeahead its library marks, never its rows, and any upstream failure a route lets
through is a `502 upstream_error` naming the service only. A transfer queued with nothing sent for
three minutes moves on to the next user and the estimate runs from the first byte; an album request
monitors the record as released and counts its songs; the stop is logged and bounded; the compose
file says the data folder must belong to 568. In the web app a 500 from the requests list shows
the unreachable words with a Retry, three placeholders hold the room while the first list loads, a
ready card says where the song arrived, an Enter pressed while the session connects is sent once
it is ready under a "Connecting…" hint that wraps, and the preview button has a 44 px target.
