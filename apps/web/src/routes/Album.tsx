import { groupByDisc, sortItems } from '@renaissance/core';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { addToQueue, playNext, playNow, sourceOf } from '../lib/actions';
import { openDialog } from '../lib/dialogs';
import { useMode } from '../lib/mode';
import { titleOf } from '../lib/names';
import { isNotFound, useAlbum, useAlbumTracks } from '../lib/queries';
import { usePageTitle } from '../lib/title';
import { usePlayer } from '../lib/usePlayer';
import { Artwork, colorIndex } from '../components/Artwork';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { FavoriteButton } from '../components/FavoriteButton';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import { TrackRow } from '../components/TrackRow';
import { focusRing } from '../components/focus';

/** Album page (F9): art, title, artist, year, genre, duration; play and shuffle; tracks split by disc. */
export function AlbumPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const mode = useMode();
  const { album, isLoading, error } = useAlbum(id);
  usePageTitle(album ? titleOf(album, t) : undefined);
  const { tracks } = useAlbumTracks(id);
  const player = usePlayer();
  const currentId = player.queue.items[player.queue.index]?.id;
  const paused = player.status !== 'playing' && player.status !== 'loading';

  if (!album) {
    // Say so while the server is asked, not a blank page (design AE); a 404 means gone, any other
    // failure means the server could not be reached (prod AM).
    return isLoading ? (
      <p role="status" className="text-caption text-muted-foreground">
        {t('player.loading')}
      </p>
    ) : (
      <EmptyState
        title={t(error && !isNotFound(error) ? 'error.unreachable' : 'album.notFound')}
        quiet
      />
    );
  }
  const title = titleOf(album, t);
  const total = album.duration ?? tracks.reduce((sum, x) => sum + x.duration, 0);
  const meta = [
    album.year,
    album.genres[0],
    t('album.tracks', { count: album.trackCount ?? tracks.length }),
    total ? t('library.minutes', { count: Math.round(total / 60) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const discs = groupByDisc(tracks);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="w-40 shrink-0 sm:w-48">
          <Artwork
            imageId={album.imageId}
            label={title}
            index={colorIndex(album.id)}
            size="lg"
            className="shadow-art"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="text-display font-semibold tracking-tight">{title}</h1>
          <p className="text-body">
            {album.artistIds[0] ? (
              <Link
                to={`/artist/${encodeURIComponent(album.artistIds[0])}`}
                className={`inline-flex min-h-6 items-center rounded-sm font-medium hover:underline ${focusRing}`}
              >
                {album.artistName || t('library.unknownArtist')}
              </Link>
            ) : (
              <span className="font-medium">{album.artistName || t('library.unknownArtist')}</span>
            )}
          </p>
          <p className="text-caption text-muted-foreground">{meta}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button
              tone="primary"
              disabled={!tracks.length}
              onClick={() => playNow(tracks, 0, sourceOf('album', id))}
            >
              <Icon name="play" className="size-4" />
              {t('album.play')}
            </Button>
            <Button
              tone="secondary"
              disabled={!tracks.length}
              onClick={() =>
                playNow(sortItems(tracks, 'random', 'asc', Date.now()), 0, sourceOf('album', id))
              }
            >
              <Icon name="shuffle" className="size-4" />
              {t('album.shuffle')}
            </Button>
            <FavoriteButton kind="album" item={album} />
            <Menu
              label={t('actions.more')}
              items={[
                {
                  key: 'next',
                  label: t('queue.playNext'),
                  icon: 'next',
                  onSelect: () => playNext(tracks, t, sourceOf('album', id)),
                },
                {
                  key: 'queue',
                  label: t('queue.addToQueue'),
                  icon: 'queue',
                  onSelect: () => addToQueue(tracks, t, sourceOf('album', id)),
                },
                {
                  key: 'playlist',
                  label: t('playlist.addTo'),
                  icon: 'playlist',
                  onSelect: () => openDialog({ kind: 'addToPlaylist', tracks }),
                },
                ...(mode === 'advanced'
                  ? [
                      {
                        key: 'download',
                        label: t('album.download'),
                        icon: 'arrowDown' as const,
                        disabled: true,
                        hint: t('album.downloadLater'),
                        onSelect: () => undefined,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </div>
      </header>
      {tracks.length === 0 ? (
        <EmptyState title={t('library.nothingHere')} quiet />
      ) : (
        discs.map((disc) => (
          <section
            key={disc.disc}
            className="flex flex-col"
            aria-label={
              discs.length > 1 ? t('album.disc', { number: disc.disc }) : t('library.tracks')
            }
          >
            {discs.length > 1 ? (
              <h2 className="px-2 pb-1 text-label font-medium text-muted-foreground">
                {t('album.disc', { number: disc.disc })}
              </h2>
            ) : null}
            <ol>
              {disc.tracks.map((track) => {
                const index = tracks.indexOf(track);
                return (
                  <li key={track.id}>
                    <TrackRow
                      track={track}
                      index={index}
                      showNumber
                      showArt={false}
                      hideAlbumLink
                      subtitle={track.artistName !== album.artistName ? track.artistName : ''}
                      playing={track.id === currentId}
                      paused={paused}
                      onPlay={() => playNow(tracks, index, sourceOf('album', id))}
                    />
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}
