import { HubClientError } from '@renaissance/core';
import type { AskResponse, CatalogueSearch, InstantResults } from '@renaissance/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHub } from '../lib/hub';
import { shortcutKey } from '../lib/platform';
import { AskResults } from './AskResults';
import { Icon } from './Icon';
import { focusWithin } from './focus';

/** The same words whatever the case and spacing: "Halo  Beyonce" and "halo beyonce". */
export function sameWords(a: string, b: string): boolean {
  const key = (s: string) => s.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  return key(a) === key(b);
}

/** How long the typing must pause before the catalogue is asked (F61: under 300 ms to rows). */
export const TYPEAHEAD_DEBOUNCE_MS = 250;
export const TYPEAHEAD_MIN_CHARS = 2;

/**
 * The one box on every screen (F75), rendered by the shell. As the user types, the catalogue is
 * asked (debounced, abortable) and the rows appear with Add and Play: the deterministic path, no
 * model. Enter sends the words to the hub (`POST /ask` as a stream): the library hits arrive first,
 * the model's answer under them. The results panel is capped at 60 % of the screen with its own
 * scroll and closes on Escape, a tap outside or an empty box. Without a hub session the box is
 * still the search box and the hint says to sign in.
 */
export function AskBar({
  autoFocus = false,
  compact = false,
}: {
  autoFocus?: boolean;
  /** Phone: no hint line until there is something to say. */
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { client, status } = useHub();
  const [value, setValue] = useState('');
  const [typeahead, setTypeahead] = useState<CatalogueSearch | null>(null);
  const [instant, setInstant] = useState<InstantResults | null>(null);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(true);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const abortTypeahead = useRef<AbortController | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A tap outside the bar closes the panel; typing again reopens it.
  useEffect(() => {
    const onPointer = (event: PointerEvent): void => {
      if (form.current && !form.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, []);

  const ready = status === 'ready' && client !== null;
  // A full catalogue answer the typeahead could not wait for (MusicBrainz's turn came after the
  // rows were shown) arrives on the event stream: it replaces the rows when the box still holds
  // the words it answers and no Enter has replaced them (design AH).
  const latest = useRef({ value: '', answered: false });
  useEffect(() => {
    latest.current = { value: value.trim(), answered: answer !== null };
  }, [value, answer]);
  useEffect(() => {
    if (!ready) return;
    return client.events((event) => {
      if (event.type !== 'catalogue') return;
      if (latest.current.answered) return;
      if (sameWords(event.result.query, latest.current.value)) setTypeahead(event.result);
    });
  }, [client, ready]);

  // Typeahead: the catalogue for the letters so far, once typing pauses; older answers are dropped
  // (the box's own change handler clears the rows when the words get too short).
  useEffect(() => {
    abortTypeahead.current?.abort();
    const q = value.trim();
    if (!ready || q.length < TYPEAHEAD_MIN_CHARS) return;
    const controller = new AbortController();
    abortTypeahead.current = controller;
    const timer = setTimeout(() => {
      client.catalogueSearch(q, controller.signal).then(
        (result) => {
          if (!controller.signal.aborted) setTypeahead(result);
        },
        (error: unknown) => {
          // Aborted (newer letters), busy or superseded (503): the rows already shown stay.
          if (controller.signal.aborted) return;
          if (error instanceof HubClientError && error.status === 503) return;
          setTypeahead(null);
        },
      );
    }, TYPEAHEAD_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, ready, client]);

  async function submit(): Promise<void> {
    const text = value.trim();
    if (!text || !client || status !== 'ready') return;
    abort.current?.abort();
    // The typeahead for these letters, in flight or still waiting its debounce, must not land
    // after the answer and refill the rows under it (design R).
    abortTypeahead.current?.abort();
    setTypeahead(null);
    const controller = new AbortController();
    abort.current = controller;
    setOpen(true);
    setPending(true);
    setFailed(false);
    setAnswer(null);
    setInstant(null);
    const language = i18n.language === 'gu' ? 'gu' : 'en';
    try {
      const result = await client.askStreaming({ text, language }, setInstant, controller.signal);
      if (!controller.signal.aborted) {
        // The answer replaces the typeahead: a deterministic "Play X" carries no rows, and the
        // rows for the letters typed must not stay under (or above) it (design R).
        setAnswer(result);
        setTypeahead(null);
      }
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }

  function clear(): void {
    abort.current?.abort();
    setAnswer(null);
    setInstant(null);
    setTypeahead(null);
    setPending(false);
  }

  const hint = failed
    ? t('ask.hubOff')
    : status === 'ready'
      ? value
        ? t('ask.enterToAsk')
        : t('ask.hint')
      : status === 'unauthorized'
        ? t('ask.signInFirst')
        : status === 'unreachable'
          ? t('ask.hubOff')
          : value
            ? t('ask.noResults')
            : t('ask.hint');
  const hasResults = instant !== null || answer !== null || pending || typeahead !== null;
  const showResults = open && hasResults;
  return (
    <form
      ref={form}
      className="flex flex-col gap-2"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && hasResults) {
          e.preventDefault();
          setOpen(false);
        }
      }}
    >
      <label className="sr-only" htmlFor="ask">
        {t('ask.placeholder')}
      </label>
      <div
        className={`flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 ${focusWithin}`}
      >
        <Icon name="search" className="size-4 text-muted-foreground" />
        <input
          id="ask"
          type="search"
          ref={input}
          autoFocus={autoFocus}
          className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
          placeholder={t('ask.placeholder')}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            if (e.target.value === '') clear();
            else if (e.target.value.trim().length < TYPEAHEAD_MIN_CHARS) setTypeahead(null);
          }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
          enterKeyHint="search"
          aria-expanded={showResults}
          aria-controls="ask-results"
        />
        <kbd
          aria-hidden
          className="hidden rounded-sm border border-border px-1.5 py-0.5 font-mono text-caption text-muted-foreground md:inline"
        >
          {shortcutKey() === 'mac' ? t('ask.shortcutMac') : t('ask.shortcut')}
        </kbd>
      </div>
      {(compact && !value && !hasResults) || answer || typeahead ? null : (
        <p className="truncate text-caption text-muted-foreground" aria-live="polite">
          {hint}
        </p>
      )}
      {showResults ? (
        <div
          id="ask-results"
          className="overflow-y-auto"
          style={{ maxHeight: '60vh' }}
          aria-label={t('ask.results')}
        >
          <AskResults instant={instant} catalogue={typeahead} answer={answer} pending={pending} />
        </div>
      ) : null}
    </form>
  );
}
