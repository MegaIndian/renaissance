import { sortItems } from '@renaissance/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { playNow } from '../lib/actions';
import { useLibrary, useSession } from '../lib/queries';
import { Button } from '../components/Button';
import { AlbumCard, ArtistCard } from '../components/Cards';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Row, RowItem } from '../components/Row';
import { SignedOut } from '../components/SignedOut';
import { TrackList } from './Library';

const FAVORITES = { kind: 'favorites' } as const;

/** Favourites (F12): this user's hearts on songs, albums and artists, synced with Jellyfin. */
export function Favorites() {
  const { t } = useTranslation();
  const { snapshot, ready } = useLibrary();
  const session = useSession();
  const tracks = useMemo(
    () =>
      sortItems(
        snapshot.tracks.filter((x) => x.isFavorite),
        'name',
      ),
    [snapshot.tracks],
  );
  const albums = useMemo(
    () =>
      sortItems(
        snapshot.albums.filter((x) => x.isFavorite),
        'name',
      ),
    [snapshot.albums],
  );
  const artists = useMemo(
    () =>
      sortItems(
        snapshot.artists.filter((x) => x.isFavorite),
        'name',
      ),
    [snapshot.artists],
  );
  const empty = !tracks.length && !albums.length && !artists.length;
  // No session, no cache to wait for: the Library's sentence and Sign in (design AG).
  if (session.status === 'signedOut') return <SignedOut title={t('favorites.title')} />;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold">{t('favorites.title')}</h1>
        {tracks.length ? (
          <>
            <Button
              tone="primary"
              className="min-h-6 py-1"
              onClick={() => playNow(tracks, 0, FAVORITES)}
            >
              <Icon name="play" className="size-3.5" />
              {t('home.playAll')}
            </Button>
            <Button
              tone="secondary"
              className="min-h-6 py-1"
              onClick={() => playNow(sortItems(tracks, 'random', 'asc', Date.now()), 0, FAVORITES)}
            >
              <Icon name="shuffle" className="size-3.5" />
              {t('home.shuffleAll')}
            </Button>
          </>
        ) : null}
      </div>
      {empty && ready ? (
        <EmptyState title={t('favorites.empty')} description={t('favorites.emptyBody')} />
      ) : null}
      {albums.length ? (
        <Row title={t('library.albums')} empty={t('library.nothingHere')} count={albums.length}>
          {albums.map((album) => (
            <RowItem key={album.id}>
              <AlbumCard album={album} />
            </RowItem>
          ))}
        </Row>
      ) : null}
      {artists.length ? (
        <Row title={t('library.artists')} empty={t('library.nothingHere')} count={artists.length}>
          {artists.map((artist) => (
            <RowItem key={artist.id}>
              <ArtistCard artist={artist} />
            </RowItem>
          ))}
        </Row>
      ) : null}
      {tracks.length ? (
        <section className="flex flex-col gap-2" aria-label={t('library.tracks')}>
          <h2 className="text-heading font-semibold">{t('library.tracks')}</h2>
          <TrackList tracks={tracks} source={FAVORITES} />
        </section>
      ) : null}
    </div>
  );
}
