/** Text helpers shared by the catalogue, the ranking step and the intent engine. */

/** Lower case, no accents, no punctuation, single spaces: the key two titles are compared by. */
export function normalize(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’`]/g, '')
      // Marks stay: Gujarati vowel signs are combining marks, and "વગાડો" must survive intact.
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
      .trim()
  );
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

/**
 * Words that carry no title: the command around a request ("play", "get me"), the filler of a
 * sentence ("for", "something") and the words for music itself. English and the Gujarati the
 * household uses, in both scripts.
 */
export const STOP_WORDS = new Set([
  ...'a an the for to of and or me my some something please while when with on in by from at '.split(
    ' ',
  ),
  ...'play put start queue get give find want i you can could would like song songs music track tracks album albums hits best new old'.split(
    ' ',
  ),
  ...'vagad vagado chalu kar chalavo gaan gaano geet geeto gana gaana lavo lavi aapo apo mane ni na nu no ne thi mate'.split(
    ' ',
  ),
  ...'વગાડ વગાડો ચાલુ કર ચલાવો ગીત ગીતો ગાન લાવો લાવ આપો મને ની ના નું નો ને થી માટે કંઈક કોઈ અને કે'.split(
    ' ',
  ),
]);

/** The words of a query that could be part of a title or an artist's name. */
export function contentTokens(text: string): string[] {
  const all = tokens(text);
  const kept = all.filter((t) => !STOP_WORDS.has(t));
  // "The The" or "Play" as a title: when every word is a stop word, the words themselves stand.
  return kept.length > 0 ? kept : all;
}

/** Verbs and phrasings that make the words a request rather than a title. */
const COMMAND =
  /^(play|put on|start|queue|get me|get|give me|find me|find|i want|i would like|can you|could you|please)\b/;
const COMMAND_END =
  /\b(vagad|vagado|chalu kar|chalavo|lavo|lavi aapo|aapo|વગાડ|વગાડો|ચાલુ કર|ચલાવો|લાવો|લાવ|આપો|આપ)$/u;

/**
 * True when the words read as a sentence rather than a name: a command verb, or four or more words
 * with at least one stop word among them ("play something calm for cooking", "રસોઈ માટે શાંત ગીત
 * વગાડ"). A five-word title with no filler ("Kabhi Kabhie Mere Dil Mein") is not a sentence.
 */
export function looksLikeSentence(text: string): boolean {
  const n = normalize(text);
  if (COMMAND.test(n) || COMMAND_END.test(n)) return true;
  const all = tokens(n);
  return all.length >= 4 && all.some((t) => STOP_WORDS.has(t));
}
