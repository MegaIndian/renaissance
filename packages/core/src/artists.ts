/**
 * Artist resolution (F8, F10). Jellyfin can hold two `MusicArtist` items for one name: a library
 * that gains artist folders after the fact gets one item under the metadata folder (what `/Artists`
 * lists) and one under the music folder (what every track's `ArtistItems` carries). The server itself
 * resolves by name: `ArtistIds=<either>` returns the same tracks. The snapshot does the same here:
 * the artist list is the server's list merged with the ids the tracks and albums carry, keyed by the
 * normalised name, and an artist page resolves by any of those ids or by name.
 */
import type { Album, Artist, ArtistCredit, Track } from './models';

/** The key two spellings of one artist share: NFKC, lower case, single spaces. */
export function artistKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The credits an item carries. Items cached before credits were stored fall back to pairing the
 * single id with the single name; several ids with one joined name cannot be paired and are skipped.
 */
export function creditsOf(
  item: Pick<Track | Album, 'artistIds' | 'artistName' | 'artistCredits'>,
): ArtistCredit[] {
  if (item.artistCredits?.length) return item.artistCredits;
  if (item.artistIds.length === 1 && item.artistName.trim()) {
    return [{ id: item.artistIds[0] as string, name: item.artistName }];
  }
  return [];
}

/**
 * One artist per name. The server's own entry wins (image, biography, favourite, play count); a
 * name that only appears in credits gets an artist built from the first credit. `ids` lists every
 * id seen for the name, the artist's own first.
 */
export function mergeArtists(
  serverArtists: readonly Artist[],
  tracks: readonly Track[],
  albums: readonly Album[],
): Artist[] {
  const byKey = new Map<string, Artist>();
  const idsByKey = new Map<string, Set<string>>();
  const keyById = new Map<string, string>();
  const add = (key: string, id: string): void => {
    let ids = idsByKey.get(key);
    if (!ids) {
      ids = new Set();
      idsByKey.set(key, ids);
    }
    ids.add(id);
    keyById.set(id, key);
  };
  for (const artist of serverArtists) {
    const key = artistKey(artist.name);
    const existing = byKey.get(key);
    if (!existing) byKey.set(key, artist);
    else if (!existing.imageId && artist.imageId) {
      byKey.set(key, { ...artist, isFavorite: existing.isFavorite || artist.isFavorite });
    }
    add(key, artist.id);
    for (const id of artist.ids ?? []) add(key, id);
  }
  for (const item of [...tracks, ...albums]) {
    for (const credit of creditsOf(item)) {
      // An id the server's list already knows belongs to that artist, whatever the item spells.
      if (keyById.has(credit.id)) continue;
      const name = credit.name.trim();
      if (!name) continue;
      const key = artistKey(name);
      if (!byKey.has(key)) byKey.set(key, { id: credit.id, name, isFavorite: false, playCount: 0 });
      add(key, credit.id);
    }
  }
  return [...byKey.entries()].map(([key, artist]) => {
    const ids = idsByKey.get(key) ?? new Set<string>();
    return { ...artist, ids: [artist.id, ...[...ids].filter((id) => id !== artist.id)] };
  });
}

/** The artist that owns `id` (its own or a merged one), else the one with this exact name. */
export function findArtist(
  artists: readonly Artist[],
  id: string | undefined,
  name?: string,
): Artist | undefined {
  if (id) {
    const byId = artists.find((a) => a.id === id || a.ids?.includes(id));
    if (byId) return byId;
  }
  if (name) {
    const key = artistKey(name);
    return artists.find((a) => artistKey(a.name) === key);
  }
  return undefined;
}

/** True when the item credits this artist under any of its ids, or by name. */
export function creditsArtist(
  item: Pick<Track | Album, 'artistIds' | 'artistName' | 'artistCredits'>,
  artist: Artist,
): boolean {
  if (item.artistIds.some((id) => id === artist.id || artist.ids?.includes(id))) return true;
  const key = artistKey(artist.name);
  return creditsOf(item).some((c) => artistKey(c.name) === key);
}
