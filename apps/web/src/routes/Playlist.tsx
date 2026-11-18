import { useQueryClient } from '@tanstack/react-query';
import { formatDuration, sortItems } from '@renaissance/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import {
  addToQueue,
  movePlaylistEntry,
  playNext,
  playNow,
  removeFromPlaylist,
} from '../lib/actions';
import { openDialog } from '../lib/dialogs';
import { usePlaylistTracks, useSnapshot } from '../lib/queries';
import { usePlayer } from '../lib/usePlayer';
import { Artwork, colorIndex } from '../components/Artwork';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { FavoriteButton } from '../components/FavoriteButton';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import { TrackRow } from '../components/TrackRow';

/**
 * Playlist page (F13): rename, delete, add, remove, drag to reorder (Move up and Move down in each
 * row's menu for the keyboard), every change synced with Jellyfin and shown in a toast.
 */
export function PlaylistPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { playlists } = useSnapshot();
  const playlist = playlists.find((p) => p.id === id);
  const entries = usePlaylistTracks(id);
  const player = usePlayer();
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const tracks = entries.data ?? [];
  const currentId = player.queue.items[player.queue.index]?.id;
  const paused = player.status !== 'playing' && player.status !== 'loading';

  if (!playlist) return <EmptyState title={t('playlist.notFound')} quiet />;
  const total = tracks.reduce((sum, x) => sum + x.duration, 0);

  const drop = (to: number): void => {
    if (dragging === null) return;
    const from = dragging;
    setDragging(null);
    setOver(null);
    const entry = tracks[from];
    if (from === to || !entry) return;
    void movePlaylistEntry(playlist, entry.entryId, to, entry.title, t, queryClient);
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="w-40 shrink-0 sm:w-48">
          <Artwork
            imageId={playlist.imageId}
            label={playlist.name}
            index={colorIndex(playlist.id)}
            size="lg"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="text-display font-semibold tracking-tight">{playlist.name}</h1>
          <p className="text-caption text-muted-foreground">
            {[
              t('library.tracksCount', { count: tracks.length || playlist.trackCount }),
              total ? formatDuration(total) : null,
              t('playlist.synced'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button tone="primary" disabled={!tracks.length} onClick={() => playNow(tracks, 0)}>
              <Icon name="play" className="size-4" />
              {t('album.play')}
            </Button>
            <Button
              tone="secondary"
              disabled={!tracks.length}
              onClick={() => playNow(sortItems(tracks, 'random', 'asc', Date.now()), 0)}
            >
              <Icon name="shuffle" className="size-4" />
              {t('album.shuffle')}
            </Button>
            <FavoriteButton kind="playlist" item={playlist} />
            <Menu
              label={t('actions.more')}
              items={[
                {
                  key: 'rename',
                  label: t('playlist.rename'),
                  icon: 'edit',
                  onSelect: () => openDialog({ kind: 'renamePlaylist', playlist }),
                },
                {
                  key: 'next',
                  label: t('queue.playNext'),
                  icon: 'next',
                  disabled: !tracks.length,
                  onSelect: () => playNext(tracks, t),
                },
                {
                  key: 'queue',
                  label: t('queue.addToQueue'),
                  icon: 'queue',
                  disabled: !tracks.length,
                  onSelect: () => addToQueue(tracks, t),
                },
                {
                  key: 'delete',
                  label: t('playlist.delete'),
                  icon: 'trash',
                  tone: 'danger',
                  onSelect: () =>
                    openDialog({
                      kind: 'deletePlaylist',
                      playlist,
                      onDeleted: () => void navigate('/library?section=playlists'),
                    }),
                },
              ]}
            />
          </div>
        </div>
      </header>
      {entries.isLoading ? null : tracks.length === 0 ? (
        <EmptyState title={t('playlist.noTracks')} description={t('playlist.noTracksBody')} />
      ) : (
        <ol aria-label={t('library.tracks')}>
          {tracks.map((entry, i) => (
            <li
              key={entry.entryId}
              draggable
              onDragStart={(e) => {
                setDragging(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(i);
              }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                drop(i);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              className={over === i && dragging !== i ? 'border-t-2 border-primary' : ''}
            >
              <TrackRow
                track={entry}
                index={i}
                playing={entry.id === currentId}
                paused={paused}
                onPlay={() => playNow(tracks, i)}
                dragHandleProps={{ 'aria-label': t('queue.dragHandle'), role: 'img' }}
                menuExtra={[
                  {
                    key: 'up',
                    label: t('queue.moveUp'),
                    icon: 'arrowUp',
                    disabled: i === 0,
                    onSelect: () =>
                      void movePlaylistEntry(
                        playlist,
                        entry.entryId,
                        i - 1,
                        entry.title,
                        t,
                        queryClient,
                      ),
                  },
                  {
                    key: 'down',
                    label: t('queue.moveDown'),
                    icon: 'arrowDown',
                    disabled: i === tracks.length - 1,
                    onSelect: () =>
                      void movePlaylistEntry(
                        playlist,
                        entry.entryId,
                        i + 1,
                        entry.title,
                        t,
                        queryClient,
                      ),
                  },
                  {
                    key: 'remove',
                    label: t('playlist.removeFrom'),
                    icon: 'close',
                    tone: 'danger',
                    onSelect: () =>
                      void removeFromPlaylist(
                        playlist,
                        [entry.entryId],
                        entry.title,
                        t,
                        queryClient,
                      ),
                  },
                ]}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
