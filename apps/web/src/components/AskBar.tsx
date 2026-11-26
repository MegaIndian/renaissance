import { normalize, rememberSearch } from '@renaissance/core';
import type {
  Album,
  Artist,
  CatalogueAlbum,
  CatalogueSong,
  LibraryIndex,
  Playlist,
  SearchGroup,
  Track,
} from '@renaissance/core';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router';
import type { NavigateFunction } from 'react-router';

import { artistNameOf, playlistNameOf, titleOf } from '../lib/names';
import { playNow } from '../lib/actions';
import { addRow, addsStore, hubStore, requestsStore, rowStatus } from '../lib/hub';
import type { CatalogueRow, RowStatus } from '../lib/hub';
import { useLibrary, useSession } from '../lib/queries';
import { recentSearchesStore, rememberRecent, clearRecent } from '../lib/recent';
import { useCatalogue } from '../lib/useCatalogue';
import { useStoreValue } from '../lib/useStore';
import { shortcutKey } from '../lib/platform';
import { Artwork, colorIndex } from './Artwork';
import {
  PreviewButton,
  RemoteArt,
  RowGlyph,
  rowHeading,
  rowSubtitle,
  stopPreview,
} from './CatalogueRow';
import { Icon } from './Icon';
import { focusRing, focusWithin } from './focus';

/** Catalogue rows under the library hits: enough to find the song, few enough to read (F61). */
export const CATALOGUE_SONGS = 5;
export const CATALOGUE_ALBUMS = 3;

type Hit =
  | { kind: 'track'; item: Track }
  | { kind: 'album'; item: Album }
  | { kind: 'artist'; item: Artist }
  | { kind: 'playlist'; item: Playlist }
  | { kind: 'song'; item: CatalogueSong }
  | { kind: 'catalogueAlbum'; item: CatalogueAlbum }
  | { kind: 'recent'; term: string }
  | { kind: 'all'; term: string };

const isCatalogue = (hit: Hit): hit is Extract<Hit, { kind: 'song' | 'catalogueAlbum' }> =>
  hit.kind === 'song' || hit.kind === 'catalogueAlbum';

function toRow(hit: Extract<Hit, { kind: 'song' | 'catalogueAlbum' }>): CatalogueRow {
  return hit.kind === 'song' ? { kind: 'song', item: hit.item } : { kind: 'album', item: hit.item };
}

const songKey = (title: string, artist: string) => `${normalize(title)}|${normalize(artist)}`;

/** The library item a catalogue row now stands for, once it is on the server and synced. */
export function localFor(row: CatalogueRow, index: LibraryIndex): Track | Album | undefined {
  const want = songKey(row.item.title, row.item.artist);
  const found = index.search(row.item.title, 20);
  if (row.kind === 'album')
    return found.albums.find((a) => songKey(a.title, a.artistName) === want);
  return (
    (row.item.libraryId ? found.tracks.find((t) => t.id === row.item.libraryId) : undefined) ??
    found.tracks.find((t) => songKey(t.title, t.artistName) === want)
  );
}

/**
 * The one box on every screen (F75, F61), rendered by the shell. First the instant layer (F11):
 * library hits from the local index as you type, recent searches when empty, keyboard through the
 * results, Enter plays a song or opens the full search page. Under the library hits, the
 * catalogue (songs and albums the server does not have, with art and a preview) from the hub: a
 * tap adds one, and the row says "on its way" and then "Ready". Without a hub the box is the
 * library search alone and says so only when it matters.
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
  const hub = useStoreValue(hubStore);
  const adds = useStoreValue(addsStore);
  const requests = useStoreValue(requestsStore);
  const signedIn = session.status === 'signedIn';
  const hubOn = signedIn && hub.client !== null;
  const { result: catalogue, failed: catalogueFailed } = useCatalogue(hubOn ? value : '');

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

  // A preview stops when the panel closes.
  useEffect(() => {
    if (!open) stopPreview();
  }, [open]);

  // Kinds ordered by their best match, so "Artist 499" lists that artist first, not the songs
  // whose titles merely contain 499.
  const groups: SearchGroup[] | null = useMemo(
    () => (signedIn && value.trim() ? index.groups(value, 4) : null),
    [index, signedIn, value],
  );

  // Library hits first (F61): a catalogue row for a song or album the library list already shows
  // is left out, so the panel never offers to add what is one row above.
  const catalogueHits: Hit[] = useMemo(() => {
    if (!catalogue || !value.trim()) return [];
    const local = new Set<string>();
    const localIds = new Set<string>();
    for (const group of groups ?? []) {
      if (group.kind === 'track')
        for (const tr of group.items) {
          local.add(songKey(tr.title, tr.artistName));
          localIds.add(tr.id);
        }
      if (group.kind === 'album')
        for (const al of group.items) {
          local.add(`album:${songKey(al.title, al.artistName)}`);
          localIds.add(al.id);
        }
    }
    const songs = catalogue.songs
      .filter(
        (s) =>
          !local.has(songKey(s.title, s.artist)) && !(s.libraryId && localIds.has(s.libraryId)),
      )
      .slice(0, CATALOGUE_SONGS)
      .map((item): Hit => ({ kind: 'song', item }));
    const albums = catalogue.albums
      .filter(
        (a) =>
          !local.has(`album:${songKey(a.title, a.artist)}`) &&
          !(a.libraryId && localIds.has(a.libraryId)),
      )
      .slice(0, CATALOGUE_ALBUMS)
      .map((item): Hit => ({ kind: 'catalogueAlbum', item }));
    return [...songs, ...albums];
  }, [catalogue, groups, value]);

  const hits: Hit[] = useMemo(() => {
    if (!signedIn) return [];
    if (!value.trim()) return recent.map((term) => ({ kind: 'recent', term }));
    const library: Hit[] = (groups ?? []).flatMap((group): Hit[] =>
      group.kind === 'track'
        ? group.items.map((item) => ({ kind: 'track', item }) as const)
        : group.kind === 'album'
          ? group.items.map((item) => ({ kind: 'album', item }) as const)
          : group.kind === 'artist'
            ? group.items.map((item) => ({ kind: 'artist', item }) as const)
            : group.items.map((item) => ({ kind: 'playlist', item }) as const),
    );
    if (!library.length && !catalogueHits.length) return [];
    return [...library, ...catalogueHits, { kind: 'all', term: value.trim() }];
  }, [recent, groups, catalogueHits, signedIn, value]);

  const firstCatalogue = hits.findIndex(isCatalogue);

  const choose = (hit: Hit): void => {
    if (isCatalogue(hit)) {
      // The panel stays open: the row is where the add says what it did.
      chooseCatalogue(toRow(hit), rowStatus(toRow(hit), adds, requests), {
        index,
        navigate,
        t,
        onPlayed: () => {
          rememberRecent(value);
          setValue('');
          setOpen(false);
        },
      });
      return;
    }
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

  const nothing = !!value.trim() && !!groups && !groups.length && !catalogueHits.length;
  const hubAway = hubOn && (hub.status === 'unreachable' || catalogueFailed);
  // Without the hub the box is the library search: the line says so once, whatever was typed.
  const hint = !signedIn
    ? t('ask.signInFirst')
    : hubAway
      ? t('catalogue.hubAwayHint')
      : hubOn && hub.status === 'unauthorized'
        ? t('catalogue.hubRefused')
        : nothing
          ? ready
            ? hubOn
              ? t('catalogue.noMatch')
              : t('ask.noResults')
            : t('library.syncingFirst')
          : hubOn
            ? t('ask.hintCatalogue')
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
      {/* The whole box is the target (rule 12): the input fills its height, and a tap on the
          magnifier or the padding focuses it too. */}
      <div
        onClick={() => input.current?.focus()}
        className={`flex cursor-text items-center gap-2 rounded-md border border-border bg-card px-3 ${focusWithin}`}
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
          className="min-w-0 flex-1 bg-transparent py-2 text-body text-foreground outline-none placeholder:text-muted-foreground"
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
        <p className="text-caption text-muted-foreground" aria-live="polite">
          {hint}
        </p>
      )}
      {showList ? (
        <div
          id={listId}
          role="listbox"
          aria-label={value.trim() ? t('ask.results') : t('ask.recent')}
          // On a phone the box sits at the bottom of the screen: the list opens upward.
          className={`absolute left-0 right-0 z-20 flex max-h-96 flex-col overflow-y-auto rounded-md border border-border bg-card p-1 shadow-low ${compact ? 'bottom-full mb-1' : 'top-full mt-1'}`}
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
            <CatalogueBoundary
              key={
                hit.kind === 'recent' || hit.kind === 'all'
                  ? `${hit.kind}-${hit.term}`
                  : `${hit.kind}-${hit.item.id}`
              }
              heading={i === firstCatalogue}
              busy={!!catalogue?.busy}
            >
              {isCatalogue(hit) ? (
                <CatalogueOption
                  id={`${listId}-${i}`}
                  row={toRow(hit)}
                  status={rowStatus(toRow(hit), adds, requests)}
                  index={i}
                  active={i === active}
                  onChoose={() => choose(hit)}
                  onHover={() => setActive(i)}
                />
              ) : (
                <ResultRow
                  id={`${listId}-${i}`}
                  hit={hit}
                  active={i === active}
                  onChoose={() => choose(hit)}
                  onHover={() => setActive(i)}
                />
              )}
            </CatalogueBoundary>
          ))}
        </div>
      ) : null}
    </form>
  );
}

/** The quiet line that starts the catalogue section; not an option, so the keyboard skips it. */
function CatalogueBoundary({
  heading,
  busy,
  children,
}: {
  heading: boolean;
  busy: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (!heading) return <>{children}</>;
  return (
    <>
      <div role="presentation" className="px-2 pb-1 pt-2 text-caption text-muted-foreground">
        {busy ? t('catalogue.headingBusy') : t('catalogue.heading')}
      </div>
      {children}
    </>
  );
}

/**
 * A tap on a catalogue row: add it when nothing has been asked yet (or the last try failed), play
 * it once it is here, and nothing while it is on its way (the row already says so).
 */
export function chooseCatalogue(
  row: CatalogueRow,
  status: RowStatus,
  ctx: { index: LibraryIndex; navigate: NavigateFunction; t: TFunction; onPlayed: () => void },
): void {
  if (status.kind === 'none' || status.kind === 'failed') {
    void addRow(row, ctx.t);
    return;
  }
  if (status.kind !== 'ready' && status.kind !== 'already') return;
  const local = localFor(row, ctx.index);
  if (!local) return;
  ctx.onPlayed();
  if (row.kind === 'album') void ctx.navigate(`/album/${encodeURIComponent(local.id)}`);
  else playNow([local as Track]);
}

function CatalogueOption({
  id,
  row,
  status,
  index,
  active,
  onChoose,
  onHover,
}: {
  id: string;
  row: CatalogueRow;
  status: RowStatus;
  index: number;
  active: boolean;
  onChoose: () => void;
  onHover: () => void;
}) {
  const { t } = useTranslation();
  const { title } = rowHeading(row);
  const label =
    status.kind === 'none'
      ? row.kind === 'album'
        ? t('catalogue.addAlbumLabel', { title: row.item.title, artist: row.item.artist })
        : t('catalogue.addLabel', { title: row.item.title, artist: row.item.artist })
      : undefined;
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-label={label}
      onMouseEnter={onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onChoose}
      className={`flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left text-body ${active ? 'bg-muted' : 'hover:bg-muted/60'}`}
    >
      <RemoteArt src={row.item.art} index={index} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{title}</span>
        <span className="truncate text-caption text-muted-foreground">
          {rowSubtitle(row, status, t)}
        </span>
      </span>
      {row.kind === 'song' && row.item.preview ? (
        <PreviewButton src={row.item.preview} title={row.item.title} />
      ) : null}
      <RowGlyph status={status} />
    </div>
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
  hit: Exclude<Hit, { kind: 'song' | 'catalogueAlbum' }>;
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
  const title =
    'title' in hit.item
      ? titleOf(hit.item, t)
      : hit.kind === 'artist'
        ? artistNameOf(hit.item, t)
        : playlistNameOf(hit.item, t);
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
