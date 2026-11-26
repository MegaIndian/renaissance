import { useQueryClient } from '@tanstack/react-query';
import type { Playlist, PlaylistEntry, Track } from '@renaissance/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, TextInput, View } from 'react-native';

import { closeDialog, dialogStore } from '@/lib/dialogs';
import { playlistNameOf } from '@/lib/names';
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  renamePlaylist,
} from '@/lib/playlist-actions';
import { useSnapshot } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { useStoreValue } from '@/lib/useStore';

import { Artwork } from './Artwork';
import { Button } from './Button';
import { Icon } from './Icon';
import { Sheet, SheetItem } from './Sheet';

/** The shell renders this once; menus anywhere open a dialog through `openDialog` (web's Dialogs). */
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
  const { space } = useTheme();
  const [creating, setCreating] = useState(false);
  if (creating) return <NewPlaylist tracks={tracks} />;
  return (
    <Sheet
      visible
      title={t('playlist.addTo')}
      onClose={closeDialog}
      closeLabel={t('actions.close')}
    >
      <ScrollView style={{ maxHeight: space[12] * 8 }}>
        <SheetItem label={t('playlist.new')} onPress={() => setCreating(true)}>
          <Icon name="plus" />
        </SheetItem>
        {playlists.map((playlist) => (
          <SheetItem
            key={playlist.id}
            label={playlistNameOf(playlist, t)}
            onPress={() => {
              closeDialog();
              void addToPlaylist(playlist, tracks, t, queryClient);
            }}
          >
            <Artwork item={playlist} size="sm" />
          </SheetItem>
        ))}
      </ScrollView>
    </Sheet>
  );
}

function NameField({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const { colors, radius, space, type, scale } = useTheme();
  return (
    <TextInput
      testID="playlist-name"
      autoFocus
      accessibilityLabel={t('playlist.name')}
      placeholder={t('playlist.name')}
      placeholderTextColor={colors.mutedForeground}
      value={value}
      onChangeText={onChange}
      onSubmitEditing={onSubmit}
      returnKeyType="done"
      style={{
        borderWidth: 1,
        borderColor: colors.inputBorder,
        borderRadius: radius.sm,
        color: colors.foreground,
        backgroundColor: colors.background,
        fontSize: type.body.size * scale,
        paddingHorizontal: space[3],
        paddingVertical: space[2],
      }}
    />
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  const { space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space[2], justifyContent: 'flex-end' }}>
      {children}
    </View>
  );
}

function NewPlaylist({ tracks }: { tracks: Track[] }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const submit = (): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    closeDialog();
    void createPlaylist(
      trimmed,
      tracks.map((x) => x.id),
      t,
    );
  };
  return (
    <Sheet visible title={t('playlist.new')} onClose={closeDialog} closeLabel={t('actions.close')}>
      <NameField value={name} onChange={setName} onSubmit={submit} />
      <Actions>
        <Button tone="ghost" title={t('playlist.cancel')} onPress={closeDialog} />
        <Button
          tone="primary"
          title={t('playlist.create')}
          disabled={!name.trim()}
          onPress={submit}
        />
      </Actions>
    </Sheet>
  );
}

function RenamePlaylist({ playlist }: { playlist: Playlist }) {
  const { t } = useTranslation();
  const [name, setName] = useState(playlist.name);
  const submit = (): void => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === playlist.name) return closeDialog();
    closeDialog();
    void renamePlaylist(playlist, trimmed, t);
  };
  return (
    <Sheet
      visible
      title={t('playlist.rename')}
      onClose={closeDialog}
      closeLabel={t('actions.close')}
    >
      <NameField value={name} onChange={setName} onSubmit={submit} />
      <Actions>
        <Button tone="ghost" title={t('playlist.cancel')} onPress={closeDialog} />
        <Button
          tone="primary"
          title={t('playlist.save')}
          disabled={!name.trim()}
          onPress={submit}
        />
      </Actions>
    </Sheet>
  );
}

function DeletePlaylist({
  playlist,
  entries,
  onDeleted,
}: {
  playlist: Playlist;
  entries: PlaylistEntry[] | undefined;
  onDeleted: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const name = playlistNameOf(playlist, t);
  return (
    <Sheet
      visible
      title={t('playlist.deleteConfirm', { name })}
      onClose={closeDialog}
      closeLabel={t('actions.close')}
    >
      <Actions>
        <Button tone="ghost" title={t('playlist.cancel')} onPress={closeDialog} />
        <Button
          tone="danger"
          title={t('playlist.delete')}
          onPress={() => {
            closeDialog();
            void deletePlaylist(playlist, t, entries ? { entries } : {}).then((ok) => {
              if (ok) onDeleted?.();
            });
          }}
        />
      </Actions>
    </Sheet>
  );
}
