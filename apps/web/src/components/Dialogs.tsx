import { useQueryClient } from '@tanstack/react-query';
import type { Playlist, PlaylistEntry, Track } from '@renaissance/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  renamePlaylist,
} from '../lib/playlist-actions';
import { playlistNameOf } from '../lib/names';
import { closeDialog, dialogStore } from '../lib/dialogs';
import { useSnapshot } from '../lib/queries';
import { useStoreValue } from '../lib/useStore';
import { Artwork, colorIndex } from './Artwork';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { focusRing } from './focus';

const inputClass = `min-h-6 rounded-sm border border-input-border bg-background px-2.5 py-1.5 text-body text-foreground ${focusRing}`;

/** The shell renders this once; menus anywhere open a dialog through `openDialog`. */
export function Dialogs() {
  const dialog = useStoreValue(dialogStore);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'addToPlaylist':
      return <AddToPlaylist tracks={dialog.tracks} />;
    case 'newPlaylist':
      return <NewPlaylist tracks={dialog.tracks ?? []} />;
    case 'renamePlaylist':
      return <RenamePlaylist playlist={dialog.playlist} />;
    case 'deletePlaylist':
      return (
        <DeletePlaylist
          playlist={dialog.playlist}
          entries={dialog.entries}
          onDeleted={dialog.onDeleted}
        />
      );
  }
}

function AddToPlaylist({ tracks }: { tracks: Track[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { playlists } = useSnapshot();
  const [creating, setCreating] = useState(false);
  if (creating) return <NewPlaylist tracks={tracks} />;
  return (
    <Dialog title={t('playlist.addTo')} onClose={closeDialog}>
      <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
        <li>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={`flex min-h-6 w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-body hover:bg-muted ${focusRing}`}
          >
            <span className="grid size-9 place-items-center rounded-sm bg-muted text-muted-foreground">
              <Icon name="plus" className="size-4" />
            </span>
            {t('playlist.new')}
          </button>
        </li>
        {playlists.map((playlist) => (
          <li key={playlist.id}>
            <button
              type="button"
              onClick={() => {
                closeDialog();
                void addToPlaylist(playlist, tracks, t, queryClient);
              }}
              className={`flex min-h-6 w-full items-center gap-3 rounded-sm px-2 py-2 text-left text-body hover:bg-muted ${focusRing}`}
            >
              <Artwork
                imageId={playlist.imageId}
                label={playlistNameOf(playlist, t)}
                index={colorIndex(playlist.id)}
                size="xs"
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{playlistNameOf(playlist, t)}</span>
                <span className="text-caption text-muted-foreground">
                  {t('library.tracksCount', { count: playlist.trackCount })}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function NewPlaylist({ tracks }: { tracks: Track[] }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={t('playlist.create')} onClose={closeDialog}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true);
          void createPlaylist(
            name.trim(),
            tracks.map((x) => x.id),
            t,
          ).finally(() => {
            setBusy(false);
            closeDialog();
          });
        }}
      >
        <label className="flex flex-col gap-1 text-label font-medium" htmlFor="playlist-name">
          {t('playlist.name')}
          <input
            id="playlist-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            autoComplete="off"
            className={inputClass}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button tone="ghost" onClick={closeDialog}>
            {t('playlist.cancel')}
          </Button>
          <Button type="submit" tone="primary" disabled={!name.trim() || busy}>
            {t('playlist.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RenamePlaylist({ playlist }: { playlist: Playlist }) {
  const { t } = useTranslation();
  const [name, setName] = useState(playlist.name);
  return (
    <Dialog title={t('playlist.rename')} onClose={closeDialog}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const next = name.trim();
          closeDialog();
          if (next && next !== playlist.name) void renamePlaylist(playlist, next, t);
        }}
      >
        <label className="flex flex-col gap-1 text-label font-medium" htmlFor="playlist-rename">
          {t('playlist.name')}
          <input
            id="playlist-rename"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            autoComplete="off"
            className={inputClass}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button tone="ghost" onClick={closeDialog}>
            {t('playlist.cancel')}
          </Button>
          <Button type="submit" tone="primary" disabled={!name.trim()}>
            {t('playlist.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeletePlaylist({
  playlist,
  entries,
  onDeleted,
}: {
  playlist: Playlist;
  entries?: PlaylistEntry[] | undefined;
  onDeleted?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      title={t('playlist.delete')}
      description={t('playlist.deleteConfirm', { name: playlist.name })}
      onClose={closeDialog}
    >
      <div className="flex justify-end gap-2">
        <Button tone="ghost" onClick={closeDialog}>
          {t('playlist.cancel')}
        </Button>
        <Button
          tone="danger"
          onClick={() => {
            closeDialog();
            void deletePlaylist(playlist, t, entries ? { entries } : {}).then((ok) => {
              if (ok) onDeleted?.();
            });
          }}
        >
          {t('playlist.delete')}
        </Button>
      </div>
    </Dialog>
  );
}
