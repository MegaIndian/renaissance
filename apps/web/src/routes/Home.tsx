import { greetingKey, sortItems } from '@renaissance/core';
import type { Track } from '@renaissance/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { playNow } from '../lib/actions';
import { useMode } from '../lib/mode';
import { useLibrary, useRecentlyPlayed, useSession } from '../lib/queries';
import { Button, LinkButton } from '../components/Button';
import { AlbumCard, TrackCard } from '../components/Cards';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Row, RowItem } from '../components/Row';
import { SyncStatus } from '../components/SyncStatus';

const HOME = { kind: 'home' } as const;

/**
 * Home (F7, F84). Simple mode, the default: greeting and three rows (My songs, Recently played, Made
 * for you), big type from the root scale. Advanced adds Recently added and Most played and names the
 * phase mixes arrive in. Signed out, one EmptyState carries the only primary action: Sign in.
 */
export function Home({ now = new Date() }: { now?: Date }) {
  const { t } = useTranslation();
  const session = useSession();
  const mode = useMode();
  const { snapshot, ready } = useLibrary();
  const recent = useRecentlyPlayed(12);
  const favorites = useMemo(
    () =>
      sortItems(
        snapshot.tracks.filter((x) => x.isFavorite),
        'lastPlayed',
      ).slice(0, 12),
    [snapshot.tracks],
  );
  const recentlyAdded = useMemo(
    () =>
      snapshot.albums.length
        ? { albums: sortItems(snapshot.albums, 'dateAdded').slice(0, 12), tracks: [] as Track[] }
        : { albums: [], tracks: sortItems(snapshot.tracks, 'dateAdded').slice(0, 12) },
    [snapshot.albums, snapshot.tracks],
  );
  const mostPlayed = useMemo(
    () =>
      sortItems(
        snapshot.tracks.filter((x) => x.playCount > 0),
        'playCount',
      ).slice(0, 12),
    [snapshot.tracks],
  );
  const greeting =
    session.status === 'signedIn' && session.session
      ? t('home.greetingWithName', {
          greeting: t(greetingKey(now)),
          name: session.session.userName,
        })
      : t(greetingKey(now));

  if (session.status === 'loading') {
    // The vault is still being read: the greeting without a name and the three row headings, with
    // the same `pending` treatment the rows get while the cache loads. No sentence says "empty" yet.
    const rows = [
      { title: t('home.mySongs'), empty: t('home.mySongsEmpty') },
      { title: t('home.recent'), empty: t('home.recentEmpty') },
      { title: t('home.mixes'), empty: t('home.mixesEmpty') },
    ];
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <h1 className="text-display font-semibold tracking-tight">{greeting}</h1>
        {rows.map((row) => (
          <Row key={row.title} title={row.title} empty={row.empty} count={0} pending>
            {null}
          </Row>
        ))}
      </div>
    );
  }

  if (session.status === 'signedOut') {
    const rows = [
      { title: t('home.mySongs'), empty: t('home.mySongsEmpty') },
      { title: t('home.recent'), empty: t('home.recentEmpty') },
      { title: t('home.mixes'), empty: t('home.mixesEmpty') },
    ];
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <h1 className="text-display font-semibold tracking-tight">{greeting}</h1>
        <EmptyState
          title={t('home.empty')}
          description={t('home.emptyBody')}
          art={
            <span
              aria-hidden
              className="grid size-12 shrink-0 place-items-center rounded-pill bg-muted text-muted-foreground"
            >
              <Icon name="person" className="size-6" />
            </span>
          }
          action={
            <LinkButton to="/sign-in" tone="primary" className="shrink-0">
              {t('signIn.submit')}
            </LinkButton>
          }
        />
        {rows.map((row) => (
          <section key={row.title} className="flex flex-col gap-2">
            <h2 className="text-heading font-semibold">{row.title}</h2>
            <EmptyState title={row.empty} quiet />
          </section>
        ))}
      </div>
    );
  }

  const trackRow = (tracks: Track[]) =>
    tracks.map((track, i) => (
      <RowItem key={track.id}>
        <TrackCard track={track} onPlay={() => playNow(tracks, i, HOME)} />
      </RowItem>
    ));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-display font-semibold tracking-tight">{greeting}</h1>
        {mode === 'advanced' ? <SyncStatus /> : null}
      </div>
      <Row
        title={t('home.mySongs')}
        to="/favorites"
        toLabel={t('nav.favorites')}
        empty={t('home.mySongsEmpty')}
        emptyBody={t('home.mySongsEmptyBody')}
        count={favorites.length}
        pending={!ready}
      >
        {trackRow(favorites)}
      </Row>
      <Row
        title={t('home.recent')}
        empty={t('home.recentEmpty')}
        count={recent.length}
        pending={!ready}
      >
        {trackRow(recent)}
      </Row>
      {mode === 'advanced' ? (
        <>
          <Row
            title={t('home.recentlyAdded')}
            to="/library?section=albums&sort=dateAdded"
            toLabel={t('library.albums')}
            empty={t('home.recentlyAddedEmpty')}
            count={recentlyAdded.albums.length + recentlyAdded.tracks.length}
            pending={!ready}
          >
            {recentlyAdded.albums.map((album) => (
              <RowItem key={album.id}>
                <AlbumCard album={album} />
              </RowItem>
            ))}
            {trackRow(recentlyAdded.tracks)}
          </Row>
          <Row
            title={t('home.mostPlayed')}
            empty={t('home.mostPlayedEmpty')}
            count={mostPlayed.length}
            pending={!ready}
          >
            {trackRow(mostPlayed)}
          </Row>
        </>
      ) : null}
      <section className="flex flex-col gap-2" aria-label={t('home.mixes')}>
        <h2 className="text-heading font-semibold">{t('home.mixes')}</h2>
        <EmptyState
          title={t('home.mixesEmpty')}
          {...(mode === 'advanced' ? { description: t('home.mixesPhase') } : {})}
          quiet={mode !== 'advanced'}
        />
      </section>
      {favorites.length || recent.length ? (
        <div className="flex gap-2">
          <Button
            tone="secondary"
            onClick={() =>
              playNow(sortItems(snapshot.tracks, 'random', 'asc', Date.now()), 0, HOME)
            }
          >
            <Icon name="shuffle" className="size-4" />
            {t('home.shuffleAll')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
