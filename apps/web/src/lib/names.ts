/**
 * What a screen prints for a song, album, artist or playlist. The cache holds names as the server
 * gave them, an empty string when the file has none (func AG), and the fallback is translated here,
 * where it is rendered, so a Gujarati screen never shows an English literal from the cache.
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
