import type { AskResponse, InstantResults } from '@renaissance/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHub } from '../lib/hub';
import { shortcutKey } from '../lib/platform';
import { AskResults } from './AskResults';
import { Icon } from './Icon';
import { focusWithin } from './focus';

/**
 * The one box on every screen (F75), rendered by the shell. Enter sends the words to the hub
 * (`POST /ask` as a stream): the library hits arrive first, the model's answer under them. Without
 * a hub session the box is still the search box and the hint says to sign in.
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
  const [instant, setInstant] = useState<InstantResults | null>(null);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);

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

  async function submit(): Promise<void> {
    const text = value.trim();
    if (!text || !client || status !== 'ready') return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPending(true);
    setFailed(false);
    setAnswer(null);
    setInstant(null);
    const language = i18n.language === 'gu' ? 'gu' : 'en';
    try {
      const result = await client.askStreaming({ text, language }, setInstant, controller.signal);
      if (!controller.signal.aborted) setAnswer(result);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
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
  const showResults = instant !== null || answer !== null || pending;
  return (
    <form
      className="flex flex-col gap-2"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
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
            if (e.target.value === '') {
              setAnswer(null);
              setInstant(null);
            }
          }}
          autoComplete="off"
          enterKeyHint="search"
        />
        <kbd
          aria-hidden
          className="hidden rounded-sm border border-border px-1.5 py-0.5 font-mono text-caption text-muted-foreground md:inline"
        >
          {shortcutKey() === 'mac' ? t('ask.shortcutMac') : t('ask.shortcut')}
        </kbd>
      </div>
      {compact && !value && !showResults ? null : (
        <p className="truncate text-caption text-muted-foreground" aria-live="polite">
          {hint}
        </p>
      )}
      {showResults ? <AskResults instant={instant} answer={answer} pending={pending} /> : null}
    </form>
  );
}
