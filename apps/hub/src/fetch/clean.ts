/**
 * Query cleaning for Soulseek (F61). The server matches whole words in file paths, so the query
 * must be the words a sharer would have in the path: no "feat.", no remaster tags, no punctuation.
 * The Soulseek server also returns nothing for some short tokens ("Lil", seen 2026-11-17: "Lil
 * Wayne Fireman" gave 0 files, "Wayne Fireman" 520), so the alternatives drop a leading "Lil".
 * A film tag in brackets ('Chaiyya Chaiyya (From "Dil Se")', the way Deezer names Bollywood
 * songs) is an edition tag too: the title is the words before it (functionality AF).
 */
import { normalize } from '../text.js';

const FEATURE = /\s*[([]?\s*(?:feat|ft|featuring|with)\.?\s+[^)\]]*[)\]]?/gi;
const TAGS =
  /\s*[([][^)\]]*(?:remaster|remastered|deluxe|edition|version|mono|stereo|bonus|anniversary|explicit|clean|radio edit|single|album|original mix|live|acoustic|demo|\bfrom\b)[^)\]]*[)\]]/gi;
const DASH_TAGS =
  /\s+-\s+(?:\d{4}\s+)?(?:remaster|remastered|deluxe|live|acoustic|radio edit|single version|album version)\b.*$/i;

export function cleanTitle(title: string): string {
  return normalize(title.replace(FEATURE, ' ').replace(TAGS, ' ').replace(DASH_TAGS, ' '));
}

export function cleanArtist(artist: string): string {
  // "A & B", "A feat. B", "A, B": the first named artist is the one in the folder name.
  const first =
    artist.split(
      /\s*(?:,|&|\+|\/|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bx\b|\bvs\.?\b|\band\b)\s*/i,
    )[0] ?? artist;
  return normalize(first);
}

/** "lil wayne" to "wayne"; "lil' kim" to "kim"; unchanged when there is no Lil to drop. */
export function dropLil(artist: string): string | undefined {
  const m = /^lil'?\s+(.+)$/i.exec(artist.trim());
  return m?.[1] ? normalize(m[1]) : undefined;
}

export interface QueryInput {
  title: string;
  artist: string;
  album?: string;
}

/**
 * Queries in the order to try them: artist + title first, then the alternatives. Each is tried only
 * when the one before returned nothing usable. Duplicates and empties are removed.
 */
export function buildQueries(input: QueryInput): string[] {
  const title = cleanTitle(input.title);
  const artist = cleanArtist(input.artist);
  const album = input.album ? cleanTitle(input.album) : '';
  const shortArtist = dropLil(artist);
  const list = [
    `${artist} ${title}`,
    shortArtist ? `${shortArtist} ${title}` : '',
    album && album !== title ? `${title} ${album}` : '',
    title,
  ];
  const seen = new Set<string>();
  return list
    .map((q) => q.trim().replace(/\s+/g, ' '))
    .filter((q) => q.length > 0 && !seen.has(q) && seen.add(q));
}
