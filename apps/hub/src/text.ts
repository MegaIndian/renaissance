/** Text helpers shared by the catalogue, the ranking step and the intent engine. */

/** Lower case, no accents, no punctuation, single spaces: the key two titles are compared by. */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function tokens(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean);
}

/** Share of `needle`'s tokens found in `haystack` (0 to 1). */
export function tokenOverlap(needle: string, haystack: string): number {
  const want = tokens(needle);
  if (want.length === 0) return 0;
  const have = new Set(tokens(haystack));
  let hit = 0;
  for (const t of want) if (have.has(t)) hit += 1;
  return hit / want.length;
}

/** True when the text has Gujarati script characters. */
export function hasGujarati(text: string): boolean {
  return /[઀-૿]/.test(text);
}

/** Lucene special characters, for MusicBrainz queries. */
export function luceneEscape(text: string): string {
  return text.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&');
}
