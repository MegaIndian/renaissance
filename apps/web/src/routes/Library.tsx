import { filterAlbums, filterTracks, sortItems } from '@renaissance/core';
import type { Album, Artist, SortKey, SortOrder } from '@renaissance/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { playNow } from '../lib/actions';
import { openDialog } from '../lib/dialogs';
import { useMode } from '../lib/mode';
import { artistNameOf, titleOf } from '../lib/names';
import { useLibrary, useSession } from '../lib/queries';
import { Button } from '../components/Button';
import { AlbumCard, ArtistCard, LabelCard, PlaylistCard } from '../components/Cards';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { SegmentedControl } from '../components/SegmentedControl';
import { SignedOut } from '../components/SignedOut';
import { SortBar } from '../components/SortBar';
import type { View } from '../components/SortBar';
import { SyncStatus } from '../components/SyncStatus';
import { TrackList, useTrackRowHeight } from '../components/TrackList';
import { VirtualList, useColumns } from '../components/VirtualList';
import { focusRing } from '../components/focus';

export { TrackList };

type Section = 'artists' | 'albumArtists' | 'albums' | 'tracks' | 'genres' | 'years' | 'playlists';
const simpleSections: Section[] = ['artists', 'albums', 'tracks', 'playlists'];
const advancedSections: Section[] = [
  'artists',
  'albumArtists',
  'albums',
  'tracks',
  'genres',
  'years',
  'playlists',
];
const sortKeysFor: Record<Section, readonly SortKey[]> = {
  artists: ['name', 'random'],
  albumArtists: ['name', 'random'],
  albums: ['name', 'dateAdded', 'year', 'playCount', 'random'],
  tracks: ['name', 'dateAdded', 'year', 'playCount', 'lastPlayed', 'random'],
  genres: ['name'],
  years: ['name'],
  playlists: ['name', 'dateAdded'],
};

function isSection(value: string | null): value is Section {
  return !!value && advancedSections.includes(value as Section);
}

/**
 * The library (F8, F15): sections in a segmented control, grid or list, sort and filter from the URL
 * so a view can be bookmarked and the Back button works. Everything reads the local cache (F14), so
 * it answers at once and works offline; 20,000 songs scroll through a virtualised list.
 */
export function Library() {
  const { t } = useTranslation();
  const mode = useMode();
  const session = useSession();
  const { snapshot, ready, sync } = useLibrary();
  const [params, setParams] = useSearchParams();
  const sections = mode === 'advanced' ? advancedSections : simpleSections;
  const requested = params.get('section');
  const section: Section =
    isSection(requested) && sections.includes(requested) ? requested : 'artists';
  const sortParam = params.get('sort') as SortKey | null;
  const sort: SortKey = sortParam && sortKeysFor[section].includes(sortParam) ? sortParam : 'name';
  const order: SortOrder =
    params.get('order') === 'asc' || params.get('order') === 'desc'
      ? (params.get('order') as SortOrder)
      : sort === 'name'
        ? 'asc'
        : 'desc';
  const view: View =
    params.get('view') === 'list' ? 'list' : section === 'tracks' ? 'list' : 'grid';
  const favoritesOnly = params.get('favorites') === '1';
  const genre = params.get('genre');
  const yearParam = Number(params.get('year'));
  const year = Number.isInteger(yearParam) && yearParam > 0 ? yearParam : null;
  const seed = Number(params.get('seed')) || 1;

  const update = (patch: Record<string, string | null>): void => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  const tracks = useMemo(
    () =>
      sortItems(
        filterTracks(snapshot.tracks, {
          favorites: favoritesOnly,
          ...(genre ? { genre } : {}),
          ...(year ? { year } : {}),
        }),
        sort,
        order,
        seed,
      ),
    [snapshot.tracks, favoritesOnly, genre, year, sort, order, seed],
  );
  const albums = useMemo(
    () =>
      sortItems(
        filterAlbums(snapshot.albums, {
          favorites: favoritesOnly,
          ...(genre ? { genre } : {}),
          ...(year ? { year } : {}),
        }),
        sort,
        order,
        seed,
      ),
    [snapshot.albums, favoritesOnly, genre, year, sort, order, seed],
  );
  const artists = useMemo(
    () =>
      sortItems(
        (section === 'albumArtists' ? snapshot.albumArtists : snapshot.artists).filter(
          (a) => !favoritesOnly || a.isFavorite,
        ),
        sort,
        order,
        seed,
      ),
    [section, snapshot.albumArtists, snapshot.artists, favoritesOnly, sort, order, seed],
  );
  const playlists = useMemo(
    () => sortItems(snapshot.playlists, sort, order, seed),
    [snapshot.playlists, sort, order, seed],
  );
  // One pass over the tracks for the genre and year cards, not one filter per card per render.
  const counts = useMemo(() => {
    const genres = new Map<string, number>();
    const years = new Map<number, number>();
    for (const x of snapshot.tracks) {
      for (const g of x.genres) genres.set(g, (genres.get(g) ?? 0) + 1);
      if (x.year) years.set(x.year, (years.get(x.year) ?? 0) + 1);
    }
    return { genres, years };
  }, [snapshot.tracks]);

  if (session.status === 'signedOut') return <SignedOut title={t('nav.library')} />;

  const sectionLabel: Record<Section, string> = {
    artists: t('library.artists'),
    albumArtists: t('library.albumArtists'),
    albums: t('library.albums'),
    tracks: t('library.tracks'),
    genres: t('library.genres'),
    years: t('library.years'),
    playlists: t('library.playlists'),
  };
  const hasFilters = favoritesOnly || !!genre || !!year;
  // The cache is still being read, or the first sync over an empty cache is running: no count line
  // (it would say 0) and no empty sentence (nothing is known yet).
  const firstSync =
    !ready || sync.status === 'loading' || (sync.status === 'syncing' && !snapshot.syncedAt);
  // The first sync failed and there is no last time to fall back on.
  const firstSyncFailed = sync.status === 'error' && !snapshot.syncedAt;
  const showCount = !firstSync && !firstSyncFailed;
  const empty = (count: number) =>
    count === 0 ? (
      firstSync ? (
        <EmptyState title={t('library.syncingFirst')} quiet />
      ) : firstSyncFailed ? (
        <EmptyState title={t('library.firstSyncFailed')} quiet />
      ) : (
        <EmptyState
          title={hasFilters ? t('library.nothingMatches') : t('library.nothingHere')}
          quiet
        />
      )
    ) : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-heading font-semibold">{t('nav.library')}</h1>
        {mode === 'advanced' ? <SyncStatus /> : null}
      </div>
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <SegmentedControl
          label={t('library.section')}
          value={section}
          options={sections.map((s) => ({ value: s, label: sectionLabel[s] }))}
          onChange={(s) =>
            update({
              section: s,
              sort: null,
              order: null,
              view: null,
              favorites: null,
              genre: null,
              year: null,
              seed: null,
            })
          }
        />
      </div>
      {mode === 'advanced' && section !== 'genres' && section !== 'years' ? (
        <SortBar
          sort={sort}
          order={order}
          onSort={(s, o) =>
            update({ sort: s, order: o, seed: s === 'random' ? String(Date.now()) : null })
          }
          allowedSorts={sortKeysFor[section]}
          onClear={() => update({ favorites: null, genre: null, year: null })}
          {...(section !== 'tracks' && section !== 'playlists'
            ? { view, onView: (v: View) => update({ view: v }) }
            : {})}
          {...(section !== 'playlists'
            ? {
                favoritesOnly,
                onFavoritesOnly: (v: boolean) => update({ favorites: v ? '1' : null }),
              }
            : {})}
          {...(section === 'tracks' || section === 'albums'
            ? {
                genres: snapshot.genres,
                genre,
                onGenre: (g: string | null) => update({ genre: g }),
                years: snapshot.years,
                year,
                onYear: (y: number | null) => update({ year: y === null ? null : String(y) }),
              }
            : {})}
        />
      ) : null}
      {section === 'tracks' ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
            {showCount ? <span>{t('library.tracksCount', { count: tracks.length })}</span> : null}
            {tracks.length ? (
              <>
                <Button tone="primary" className="min-h-6 py-1" onClick={() => playNow(tracks, 0)}>
                  <Icon name="play" className="size-3.5" />
                  {t('home.playAll')}
                </Button>
                <Button
                  tone="secondary"
                  className="min-h-6 py-1"
                  onClick={() => playNow(sortItems(tracks, 'random', 'asc', Date.now()), 0)}
                >
                  <Icon name="shuffle" className="size-3.5" />
                  {t('home.shuffleAll')}
                </Button>
              </>
            ) : null}
          </div>
          {empty(tracks.length) ?? <TrackList tracks={tracks} />}
        </>
      ) : null}
      {section === 'albums' ? (
        <>
          {showCount ? (
            <p className="text-caption text-muted-foreground">
              {t('library.albumsCount', { count: albums.length })}
            </p>
          ) : null}
          {empty(albums.length) ?? <AlbumGrid albums={albums} view={view} />}
        </>
      ) : null}
      {section === 'artists' || section === 'albumArtists' ? (
        <>
          {showCount ? (
            <p className="text-caption text-muted-foreground">
              {t('library.artistsCount', { count: artists.length })}
            </p>
          ) : null}
          {empty(artists.length) ?? <ArtistGrid artists={artists} view={view} />}
        </>
      ) : null}
      {section === 'genres'
        ? (empty(snapshot.genres.length) ?? (
            <CardGrid
              items={snapshot.genres}
              keyOf={(g) => g}
              render={(g, i) => (
                <LabelCard
                  to={`/library?section=tracks&genre=${encodeURIComponent(g)}`}
                  title={g}
                  subtitle={t('library.tracksCount', { count: counts.genres.get(g) ?? 0 })}
                  index={i}
                />
              )}
            />
          ))
        : null}
      {section === 'years'
        ? (empty(snapshot.years.length) ?? (
            <CardGrid
              items={snapshot.years}
              keyOf={(y) => String(y)}
              render={(y, i) => (
                <LabelCard
                  to={`/library?section=tracks&year=${y}`}
                  title={String(y)}
                  subtitle={t('library.tracksCount', { count: counts.years.get(y) ?? 0 })}
                  index={i}
                />
              )}
            />
          ))
        : null}
      {section === 'playlists' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/favorites"
              className={`inline-flex min-h-6 items-center rounded-sm text-caption text-muted-foreground underline underline-offset-2 hover:text-foreground ${focusRing}`}
            >
              {t('nav.favorites')}
            </Link>
            <Button
              tone="secondary"
              className="ml-auto min-h-6 py-1"
              onClick={() => openDialog({ kind: 'newPlaylist' })}
            >
              <Icon name="plus" className="size-3.5" />
              {t('playlist.new')}
            </Button>
          </div>
          {playlists.length === 0 ? (
            firstSync || firstSyncFailed ? (
              empty(0)
            ) : (
              <EmptyState title={t('playlist.empty')} description={t('playlist.emptyBody')} />
            )
          ) : (
            <CardGrid
              items={playlists}
              keyOf={(p) => p.id}
              render={(p) => <PlaylistCard playlist={p} />}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

function CardGrid<T>({
  items,
  keyOf,
  render,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  render: (item: T, index: number) => React.ReactNode;
}) {
  const [columns, ref] = useColumns(144, 8);
  return (
    <div ref={ref}>
      <VirtualList
        items={items}
        columns={columns}
        gap={8}
        rowHeight={224}
        role="grid"
        keyOf={keyOf}
        renderItem={render}
      />
    </div>
  );
}

function AlbumGrid({ albums, view }: { albums: Album[]; view: View }) {
  const { t } = useTranslation();
  const rowHeight = useTrackRowHeight();
  if (view === 'list') {
    return (
      <VirtualList
        items={albums}
        rowHeight={rowHeight}
        keyOf={(a) => a.id}
        renderItem={(album) => (
          <Link
            to={`/album/${encodeURIComponent(album.id)}`}
            className="flex h-14 items-center gap-3 border-b border-border px-2 hover:bg-muted/40"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body font-medium">{titleOf(album, t)}</span>
              <span className="truncate text-caption text-muted-foreground">
                {[
                  album.artistName || t('library.unknownArtist'),
                  album.year,
                  album.trackCount ? t('album.tracks', { count: album.trackCount }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </Link>
        )}
      />
    );
  }
  return (
    <CardGrid items={albums} keyOf={(a) => a.id} render={(album) => <AlbumCard album={album} />} />
  );
}

function ArtistGrid({ artists, view }: { artists: Artist[]; view: View }) {
  const { t } = useTranslation();
  const rowHeight = useTrackRowHeight();
  if (view === 'list') {
    return (
      <VirtualList
        items={artists}
        rowHeight={rowHeight}
        keyOf={(a) => a.id}
        renderItem={(artist) => (
          <Link
            to={`/artist/${encodeURIComponent(artist.id)}`}
            className="flex h-14 items-center gap-3 border-b border-border px-2 text-body font-medium hover:bg-muted/40"
          >
            <span className="truncate">{artistNameOf(artist, t)}</span>
          </Link>
        )}
      />
    );
  }
  return (
    <CardGrid
      items={artists}
      keyOf={(a) => a.id}
      render={(artist) => <ArtistCard artist={artist} />}
    />
  );
}
