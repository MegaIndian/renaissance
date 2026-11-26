/**
 * What a screen prints for a song, album, artist or playlist: the cache holds names as the server
 * gave them, an empty string when the file has none, and the fallback is translated here (web's
 * `names.ts`).
 */
import type { TFunction } from 'i18next';

export function titleOf(item: { title: string }, t: TFunction): string {
  return item.title || t('library.untitled');
}

export function artistNameOf(item: { name: string }, t: TFunction): string {
  return item.name || t('library.unknownArtist');
}

export function playlistNameOf(item: { name: string }, t: TFunction): string {
  return item.name || t('library.untitled');
}
