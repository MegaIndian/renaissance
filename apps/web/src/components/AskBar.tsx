import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The one box on every screen (F75). Phase 0: the input and its hint only; library hits and the
 * hub's streamed answer come in phases 1 and 2.
 */
export function AskBar({ autoFocus = false }: { autoFocus?: boolean }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
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
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 focus-within:ring-3 focus-within:ring-ring/25">
        <span
          aria-hidden
          className="inline-block size-3 rounded-full border-[1.5px] border-muted-foreground"
        />
        <input
          id="ask"
          autoFocus={autoFocus}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
          placeholder={t('ask.placeholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
        />
        <kbd className="hidden rounded-sm border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground md:inline">
          ⌘K
        </kbd>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {value ? t('ask.noResults') : t('ask.hint')}
      </p>
    </form>
  );
}
