import { isEmptyResult, rememberSearch } from '@renaissance/core';
import type { Album, Artist, Playlist, SearchResult, Track } from '@renaissance/core';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { playNow } from '../lib/actions';
import { useLibrary, useSession } from '../lib/queries';
import { recentSearchesStore, rememberRecent, clearRecent } from '../lib/recent';
import { useStoreValue } from '../lib/useStore';
import { shortcutKey } from '../lib/platform';
import { Artwork, colorIndex } from './Artwork';
import { Icon } from './Icon';
import { focusRing, focusWithin } from './focus';

/**
 * The one box on every screen (F75), rendered by the shell. Phase 1 is the instant layer (F11):
 * library hits from the local index as you type, recent searches when empty, keyboard through the
 * results, Enter plays a song or opens the full search page. No hub is configured yet, so the bar
 * is the search box and says nothing about asking in words.
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
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLFormElement>(null);
  const listId = useId();
  const { index, ready } = useLibrary();
  const session = useSession();
  const recent = useStoreValue(recentSearchesStore);
  const signedIn = session.status === 'signedIn';

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

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent): void => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  const results: SearchResult | null = useMemo(
    () => (signedIn && value.trim() ? index.search(value, 4) : null),
    [index, signedIn, value],
  );

  type Hit =
    | { kind: 'track'; item: Track }
    | { kind: 'album'; item: Album }
    | { kind: 'artist'; item: Artist }
    | { kind: 'playlist'; item: Playlist }
    | { kind: 'recent'; term: string }
    | { kind: 'all'; term: string };

  const hits: Hit[] = useMemo(() => {
    if (!signedIn) return [];
    if (!value.trim()) return recent.map((term) => ({ kind: 'recent', term }));
    if (!results || isEmptyResult(results)) return [];
    return [
      ...results.tracks.map((item) => ({ kind: 'track', item }) as const),
      ...results.albums.map((item) => ({ kind: 'album', item }) as const),
      ...results.artists.map((item) => ({ kind: 'artist', item }) as const),
      ...results.playlists.map((item) => ({ kind: 'playlist', item }) as const),
      { kind: 'all', term: value.trim() },
    ];
  }, [recent, results, signedIn, value]);

  const choose = (hit: Hit): void => {
    setOpen(false);
    setActive(-1);
    switch (hit.kind) {
      case 'track':
        rememberRecent(value);
        playNow([hit.item]);
        setValue('');
        break;
      case 'album':
        rememberRecent(value);
        setValue('');
        void navigate(`/album/${encodeURIComponent(hit.item.id)}`);
        break;
      case 'artist':
        rememberRecent(value);
        setValue('');
        void navigate(`/artist/${encodeURIComponent(hit.item.id)}`);
        break;
      case 'playlist':
        rememberRecent(value);
        setValue('');
        void navigate(`/playlist/${encodeURIComponent(hit.item.id)}`);
        break;
      case 'recent':
        setValue(hit.term);
        setOpen(true);
        input.current?.focus();
        break;
      case 'all':
        rememberRecent(hit.term);
        void navigate(`/search?q=${encodeURIComponent(hit.term)}`);
        break;
    }
  };

  const hint = !signedIn
    ? t('ask.signInFirst')
    : value.trim() && results && isEmptyResult(results)
      ? ready
        ? t('ask.noResults')
        : t('library.syncingFirst')
      : t('ask.hintSearchOnly');

  const showList = open && hits.length > 0;

  return (
    <form
      ref={box}
      className="relative flex flex-col gap-2"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        if (active >= 0 && hits[active]) choose(hits[active] as Hit);
        else if (value.trim() && signedIn) choose({ kind: 'all', term: value.trim() });
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
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
          placeholder={t('ask.placeholder')}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(hits.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            } else if (e.key === 'Escape') {
              setOpen(false);
              setActive(-1);
              if (!value) input.current?.blur();
              else setValue('');
            }
          }}
          autoComplete="off"
          enterKeyHint="search"
        />
        {value ? (
          <button
            type="button"
            aria-label={t('actions.close')}
            onClick={() => {
              setValue('');
              input.current?.focus();
            }}
            className={`grid size-6 place-items-center rounded-pill text-muted-foreground hover:text-foreground ${focusRing}`}
          >
            <Icon name="close" className="size-3.5" />
          </button>
        ) : (
          <kbd
            aria-hidden
            className="hidden rounded-sm border border-border px-1.5 py-0.5 font-mono text-caption text-muted-foreground md:inline"
          >
            {shortcutKey() === 'mac' ? t('ask.shortcutMac') : t('ask.shortcut')}
          </kbd>
        )}
      </div>
      {compact && !value && !showList ? null : (
        <p className="truncate text-caption text-muted-foreground" aria-live="polite">
          {hint}
        </p>
      )}
      {showList ? (
        <div
          id={listId}
          role="listbox"
          aria-label={value.trim() ? t('ask.results') : t('ask.recent')}
          className="absolute left-0 right-0 top-full z-20 mt-1 flex max-h-96 flex-col overflow-y-auto rounded-md border border-border bg-card p-1 shadow-low"
        >
          {!value.trim() ? (
            <div className="flex items-center justify-between px-2 py-1 text-caption text-muted-foreground">
              <span>{t('ask.recent')}</span>
              <button
                type="button"
                onClick={() => clearRecent()}
                className={`rounded-sm hover:text-foreground ${focusRing}`}
              >
                {t('ask.clearRecent')}
              </button>
            </div>
          ) : null}
          {hits.map((hit, i) => (
            <ResultRow
              key={
                hit.kind === 'recent' || hit.kind === 'all'
                  ? `${hit.kind}-${hit.term}`
                  : `${hit.kind}-${hit.item.id}`
              }
              id={`${listId}-${i}`}
              hit={hit}
              active={i === active}
              onChoose={() => choose(hit)}
              onHover={() => setActive(i)}
            />
          ))}
        </div>
      ) : null}
    </form>
  );
}

function ResultRow({
  id,
  hit,
  active,
  onChoose,
  onHover,
}: {
  id: string;
  hit:
    | { kind: 'track'; item: Track }
    | { kind: 'album'; item: Album }
    | { kind: 'artist'; item: Artist }
    | { kind: 'playlist'; item: Playlist }
    | { kind: 'recent'; term: string }
    | { kind: 'all'; term: string };
  active: boolean;
  onChoose: () => void;
  onHover: () => void;
}) {
  const { t } = useTranslation();
  const base = `flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left text-body ${active ? 'bg-muted' : 'hover:bg-muted/60'}`;
  if (hit.kind === 'recent' || hit.kind === 'all') {
    return (
      <div
        id={id}
        role="option"
        aria-selected={active}
        onMouseEnter={onHover}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onChoose}
        className={base}
      >
        <Icon name="search" className="size-4 text-muted-foreground" />
        <span className="truncate">{hit.kind === 'all' ? t('ask.seeAll') : hit.term}</span>
      </div>
    );
  }
  const title = 'title' in hit.item ? hit.item.title : hit.item.name;
  const kindLabel = t(
    `search.${hit.kind === 'track' ? 'tracks' : hit.kind === 'album' ? 'albums' : hit.kind === 'artist' ? 'artists' : 'playlists'}`,
  );
  const subtitle =
    hit.kind === 'track'
      ? hit.item.artistName
      : hit.kind === 'album'
        ? hit.item.artistName
        : hit.kind === 'playlist'
          ? t('library.tracksCount', { count: hit.item.trackCount })
          : '';
  const imageId = hit.item.imageId;
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onChoose}
      className={base}
    >
      <Artwork
        imageId={imageId}
        label={title}
        index={colorIndex(hit.item.id)}
        size="xs"
        rounded={hit.kind === 'artist' ? 'rounded-pill' : 'rounded-sm'}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{title}</span>
        <span className="truncate text-caption text-muted-foreground">
          {[kindLabel, subtitle].filter(Boolean).join(' · ')}
        </span>
      </span>
      {hit.kind === 'track' ? <Icon name="play" className="size-4 text-muted-foreground" /> : null}
    </div>
  );
}

export { rememberSearch };
