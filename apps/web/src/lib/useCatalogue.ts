import { HubClientError, normalize } from '@renaissance/core';
import type { CatalogueSearch } from '@renaissance/core';
import { useEffect, useState } from 'react';

import { hubAnswered, hubStore, lateCatalogueStore } from './hub';
import { useStoreValue } from './useStore';

/** How long the typing must pause before the catalogue is asked (F61: rows in under 300 ms). */
export const TYPEAHEAD_DEBOUNCE_MS = 250;
export const TYPEAHEAD_MIN_CHARS = 2;

/** The same words whatever the case, accents and spacing: "Halo  Beyoncé" and "halo beyonce". */
export function sameWords(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

/**
 * The catalogue rows for the words in the box: asked once typing pauses, older answers dropped,
 * the rows already shown kept when the hub says it is busy (503) so they do not flicker away.
 * `full` waits for MusicBrainz (the search page behind Enter) instead of answering at once.
 */
export function useCatalogue(
  words: string,
  options: { full?: boolean; debounceMs?: number } = {},
): { result: CatalogueSearch | null; loading: boolean; failed: boolean } {
  const { client } = useStoreValue(hubStore);
  const late = useStoreValue(lateCatalogueStore);
  const [result, setResult] = useState<CatalogueSearch | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const q = words.trim();
  const full = options.full ?? false;
  const debounceMs = options.debounceMs ?? (full ? 0 : TYPEAHEAD_DEBOUNCE_MS);

  useEffect(() => {
    if (!client || q.length < TYPEAHEAD_MIN_CHARS) {
      setResult(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      client.catalogueSearch(q, controller.signal, { full }).then(
        (answer) => {
          if (controller.signal.aborted) return;
          hubAnswered();
          setResult(answer);
          setFailed(false);
          setLoading(false);
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setLoading(false);
          // Busy or superseded: the rows already shown stay, the next letters ask again.
          if (error instanceof HubClientError && error.status === 503) return;
          setResult(null);
          setFailed(true);
        },
      );
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, q, full, debounceMs]);

  // The full answer the typeahead could not wait for replaces the rows while the box still holds
  // the words it answers (design AH).
  useEffect(() => {
    if (late && !full && sameWords(late.query, q)) setResult(late);
  }, [late, q, full]);

  return { result: q.length >= TYPEAHEAD_MIN_CHARS ? result : null, loading, failed };
}
