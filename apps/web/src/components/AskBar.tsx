import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { shortcutKey } from '../lib/platform';
import { Icon } from './Icon';
import { focusWithin } from './focus';

/**
 * The one box on every screen (F75), rendered by the shell. Phase 0: the input, its hint and the
 * ⌘K / Ctrl K shortcut; library hits and the hub's streamed answer come in phases 1 and 2.
 */
export function AskBar({
  autoFocus = false,
  compact = false,
}: {
  autoFocus?: boolean;
  /** Phone: no hint line until there is something to say. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);

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

  const hint = value ? t('ask.noResults') : t('ask.hint');
  return (
    <form
      className="flex flex-col gap-2"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
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
          onChange={(e) => setValue(e.target.value)}
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
      {compact && !value ? null : (
        <p className="truncate text-caption text-muted-foreground" aria-live="polite">
          {hint}
        </p>
      )}
    </form>
  );
}
