/**
 * Household rules (F80) as the ranking step reads them: plain words, matched to a small vocabulary.
 * A rule the vocabulary does not know is kept (the intent engine still sees it) but changes nothing
 * here, and `policy.unknown` lists it so the apps can say so.
 */
import { normalize } from '../text.js';

/** File-name tokens that mark a version someone may not want. */
export const VERSION_TOKENS: Record<string, RegExp> = {
  live: /\b(live|concert|unplugged|mtv|tour)\b/i,
  remix: /\b(remix|rmx|mix|edit|bootleg|mashup)\b/i,
  instrumental: /\b(instrumental|karaoke|backing)\b/i,
  karaoke: /\bkaraoke\b/i,
  cover: /\b(cover|tribute|in the style of)\b/i,
  acoustic: /\b(acoustic|unplugged)\b/i,
  'sped up': /\b(sped|speed|nightcore)\b/i,
  slowed: /\b(slowed|reverb)\b/i,
  demo: /\b(demo|snippet|preview|leak)\b/i,
  explicit: /\b(explicit|dirty)\b/i,
  clean: /\b(clean|censored|radio)\b/i,
};

/** Rule phrases that mean "exclude" and the vocabulary word they attach to. */
const NEGATIONS = /\b(no|not|never|avoid|skip|without|don'?t want|don'?t like|hate|dislike)\b/;

export interface RulePolicy {
  /** Vocabulary keys whose files are excluded. */
  exclude: string[];
  preferLossless: boolean;
  preferSmall: boolean;
  /** Rules that matched nothing in the vocabulary. */
  unknown: string[];
}

export const emptyPolicy = (): RulePolicy => ({
  exclude: [],
  preferLossless: false,
  preferSmall: false,
  unknown: [],
});

export function parseRules(texts: readonly string[]): RulePolicy {
  const policy = emptyPolicy();
  for (const raw of texts) {
    const text = normalize(raw);
    let matched = false;
    if (NEGATIONS.test(text)) {
      for (const key of Object.keys(VERSION_TOKENS)) {
        const word = key.replace(/\s+/g, ' ');
        if (new RegExp(`\\b${word}(s|es|d| version| versions| songs| tracks)?\\b`).test(text)) {
          if (!policy.exclude.includes(key)) policy.exclude.push(key);
          matched = true;
        }
      }
    }
    if (
      /\b(prefer|want|only|always)\b.*\b(flac|lossless|hi res|hires|high quality|best quality)\b/.test(
        text,
      )
    ) {
      policy.preferLossless = true;
      matched = true;
    }
    if (
      /\b(mp3|small|smaller|space|data)\b/.test(text) &&
      /\b(fine|ok|okay|prefer|enough|save)\b/.test(text)
    ) {
      policy.preferSmall = true;
      matched = true;
    }
    if (!matched) policy.unknown.push(raw);
  }
  return policy;
}
