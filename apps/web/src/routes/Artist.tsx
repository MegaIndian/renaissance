import { sortItems } from '@renaissance/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { playNow, sourceOf } from '../lib/actions';
import { artistNameOf } from '../lib/names';
import {
  isNotFound,
  useArtist,
  useArtistItems,
  useSimilarArtists,
  useSnapshot,
} from '../lib/queries';
import { usePageTitle } from '../lib/title';
import { useMode } from '../lib/mode';
import { Artwork, colorIndex } from '../components/Artwork';
import { Button } from '../components/Button';
import { AlbumCard, ArtistCard } from '../components/Cards';
import { EmptyState } from '../components/EmptyState';
import { FavoriteButton } from '../components/FavoriteButton';
import { Icon } from '../components/Icon';
import { Row, RowItem } from '../components/Row';
import { focusRing } from '../components/focus';
import { TrackList } from './Library';

/**
 * Artist page (F10): art, name, biography, albums (full length) and singles/EPs, songs the artist
 * appears on, similar artists from the server. All lists come from the cache except the biography
 * and similar artists. The route id may be any id the server uses for this artist (the `/Artists`
 * one or the one tracks carry); songs and albums are matched by every id known for the name, and by
 * the name itself, so a server with two entities for one artist shows one full page (and works with
 * the server down, since nothing here needs it).
 */
export function ArtistPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const mode = useMode();
  const { artist, isLoading, error } = useArtist(id);
  usePageTitle(artist ? artistNameOf(artist, t) : undefined);
  const similar = useSimilarArtists(artist?.id ?? id);
  const snapshot = useSnapshot();
  const items = useArtistItems(artist);
  const [bioOpen, setBioOpen] = useState(false);

  const albums = useMemo(() => sortItems(items.albums, 'year'), [items.albums]);
  const full = albums.filter((a) => (a.trackCount ?? 0) > 6);
  const singles = albums.filter((a) => (a.trackCount ?? 0) <= 6);
  const tracks = useMemo(() => sortItems(items.tracks, 'playCount'), [items.tracks]);
  const albumIds = new Set(albums.map((a) => a.id));
  const appearsOn = useMemo(
    () =>
      snapshot.albums.filter((a) => !albumIds.has(a.id) && tracks.some((x) => x.albumId === a.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot.albums, tracks, albums],
  );

  if (!artist) {
    // Say so while the server is asked, not a blank page (design AE); a 404 means gone, any other
    // failure means the server could not be reached (prod AM).
    return isLoading ? (
      <p role="status" className="text-caption text-muted-foreground">
        {t('player.loading')}
      </p>
    ) : (
      <EmptyState
        title={t(error && !isNotFound(error) ? 'error.unreachable' : 'artist.notFound')}
        quiet
      />
    );
  }
  const name = artistNameOf(artist, t);
  const bio = artist.bio?.trim();
  const shortBio = bio && bio.length > 280 && !bioOpen ? `${bio.slice(0, 280).trimEnd()}…` : bio;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="w-32 shrink-0 sm:w-40">
          <Artwork
            imageId={artist.imageId}
            label={name}
            index={colorIndex(artist.id)}
            size="lg"
            rounded="rounded-pill"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="text-display font-semibold tracking-tight">{name}</h1>
          <p className="text-caption text-muted-foreground">
            {[
              t('library.albumsCount', { count: albums.length }),
              t('library.tracksCount', { count: tracks.length }),
            ].join(' · ')}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button
              tone="primary"
              disabled={!tracks.length}
              onClick={() => playNow(tracks, 0, sourceOf('artist', id))}
            >
              <Icon name="play" className="size-4" />
              {t('artist.playAll')}
            </Button>
            <Button
              tone="secondary"
              disabled={!tracks.length}
              onClick={() =>
                playNow(sortItems(tracks, 'random', 'asc', Date.now()), 0, sourceOf('artist', id))
              }
            >
              <Icon name="shuffle" className="size-4" />
              {t('artist.shuffleAll')}
            </Button>
            <FavoriteButton kind="artist" item={artist} />
          </div>
        </div>
      </header>
      {shortBio ? (
        <section className="flex flex-col gap-1" aria-label={t('artist.bio')}>
          <h2 className="text-label font-medium text-muted-foreground">{t('artist.bio')}</h2>
          <p className="max-w-3xl whitespace-pre-line text-body">{shortBio}</p>
          {bio && bio.length > 280 ? (
            <button
              type="button"
              onClick={() => setBioOpen((o) => !o)}
              className={`self-start rounded-sm text-caption text-muted-foreground hover:text-foreground ${focusRing}`}
            >
              {bioOpen ? t('artist.bioLess') : t('artist.bioMore')}
            </button>
          ) : null}
        </section>
      ) : null}
      {albums.length ? (
        <Row
          title={t('artist.albums')}
          empty={t('library.nothingHere')}
          count={full.length || albums.length}
        >
          {(full.length ? full : albums).map((album) => (
            <RowItem key={album.id}>
              <AlbumCard album={album} />
            </RowItem>
          ))}
        </Row>
      ) : null}
      {full.length && singles.length ? (
        <Row title={t('artist.singles')} empty={t('library.nothingHere')} count={singles.length}>
          {singles.map((album) => (
            <RowItem key={album.id}>
              <AlbumCard album={album} />
            </RowItem>
          ))}
        </Row>
      ) : null}
      <section className="flex flex-col gap-2" aria-label={t('artist.topTracks')}>
        <h2 className="text-heading font-semibold">{t('artist.topTracks')}</h2>
        {tracks.length ? (
          <TrackList
            tracks={tracks.slice(0, mode === 'advanced' ? 200 : 20)}
            source={sourceOf('artist', id)}
          />
        ) : (
          <EmptyState title={t('library.nothingHere')} quiet />
        )}
      </section>
      {appearsOn.length ? (
        <Row
          title={t('artist.appearsOn')}
          empty={t('library.nothingHere')}
          count={appearsOn.length}
        >
          {appearsOn.map((album) => (
            <RowItem key={album.id}>
              <AlbumCard album={album} />
            </RowItem>
          ))}
        </Row>
      ) : null}
      {similar.data?.length ? (
        <Row
          title={t('artist.similar')}
          empty={t('library.nothingHere')}
          count={similar.data.length}
        >
          {similar.data.map((a) => (
            <RowItem key={a.id}>
              <ArtistCard artist={a} />
            </RowItem>
          ))}
        </Row>
      ) : null}
    </div>
  );
}
