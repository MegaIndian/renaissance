import { filterAlbums, filterTracks, sortItems } from '@renaissance/core';
import type { Album, Artist, Playlist, SortKey } from '@renaissance/core';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { AlbumCard, ArtistCard, PlaylistCard } from '@/components/Cards';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SyncStatus } from '@/components/SyncStatus';
import { TrackList } from '@/components/TrackList';
import { openDialog } from '@/lib/dialogs';
import { useLibrary, useSession } from '@/lib/queries';
import { useTheme } from '@/lib/theme';

type Section = 'artists' | 'albums' | 'tracks' | 'genres' | 'playlists';
const sections: Section[] = ['artists', 'albums', 'tracks', 'genres', 'playlists'];
const sortKeysFor: Record<Section, readonly SortKey[]> = {
  artists: ['name', 'random'],
  albums: ['name', 'dateAdded', 'year', 'random'],
  tracks: ['name', 'dateAdded', 'playCount', 'random'],
  genres: ['name'],
  playlists: ['name', 'dateAdded'],
};
const sortLabel: Record<SortKey, string> = {
  name: 'library.sortName',
  dateAdded: 'library.sortDateAdded',
  year: 'library.sortYear',
  playCount: 'library.sortPlayCount',
  lastPlayed: 'library.sortLastPlayed',
  random: 'library.sortRandom',
  lastSaved: 'library.sortDateAdded',
};

/**
 * The library (F8, F15): artists, albums, songs, genres and playlists in a segmented control, each
 * sortable, with a favourites filter. Everything reads the local cache (F14), so it answers at once
 * and works offline; long lists are virtualised.
 */
export default function Library() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, space, type, scale } = useTheme();
  const session = useSession();
  const { snapshot, ready } = useLibrary();
  const [section, setSection] = useState<Section>('artists');
  const [sorts, setSorts] = useState<Partial<Record<Section, SortKey>>>({});
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [seed, setSeed] = useState(1);
  const sort = sorts[section] ?? 'name';
  const order = sort === 'name' ? 'asc' : 'desc';

  const tracks = useMemo(
    () => sortItems(filterTracks(snapshot.tracks, { favorites: favoritesOnly }), sort, order, seed),
    [snapshot.tracks, favoritesOnly, sort, order, seed],
  );
  const albums = useMemo(
    () => sortItems(filterAlbums(snapshot.albums, { favorites: favoritesOnly }), sort, order, seed),
    [snapshot.albums, favoritesOnly, sort, order, seed],
  );
  const artists = useMemo(
    () =>
      sortItems(
        snapshot.albumArtists.length ? snapshot.albumArtists : snapshot.artists,
        sort,
        order,
        seed,
      ).filter((a) => !favoritesOnly || a.isFavorite),
    [snapshot.albumArtists, snapshot.artists, favoritesOnly, sort, order, seed],
  );
  const playlists = useMemo(
    () => sortItems(snapshot.playlists, sort, order, seed),
    [snapshot.playlists, sort, order, seed],
  );
  const genres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const track of snapshot.tracks)
      for (const g of track.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
    return snapshot.genres.map((name) => ({ name, count: counts.get(name) ?? 0 }));
  }, [snapshot.tracks, snapshot.genres]);

  if (session.status !== 'signedIn') {
    return (
      <View style={{ flex: 1, padding: space[4], backgroundColor: colors.background }}>
        <EmptyState title={t('library.empty')} quiet />
      </View>
    );
  }

  const sectionLabel: Record<Section, string> = {
    artists: t('library.artists'),
    albums: t('library.albums'),
    tracks: t('library.tracks'),
    genres: t('library.genres'),
    playlists: t('library.playlists'),
  };
  const filterable = section === 'artists' || section === 'albums' || section === 'tracks';
  const header = (
    <View style={{ padding: space[4], gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text
          accessibilityRole="header"
          style={{
            color: colors.foreground,
            fontSize: type.heading.size * scale,
            fontWeight: '600',
          }}
        >
          {t('library.title')}
        </Text>
        <Button
          tone="ghost"
          title={t('nav.favorites')}
          icon={<Icon name="heart" />}
          onPress={() => router.push('/favorites')}
        />
      </View>
      <SyncStatus />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <SegmentedControl
          label={t('library.section')}
          value={section}
          options={sections.map((value) => ({ value, label: sectionLabel[value] }))}
          onChange={setSection}
        />
      </ScrollView>
      {sortKeysFor[section].length > 1 || filterable ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space[2], alignItems: 'center' }}
        >
          {sortKeysFor[section].length > 1 ? (
            <SegmentedControl
              label={t('library.sortBy')}
              value={sort}
              options={sortKeysFor[section].map((value) => ({ value, label: t(sortLabel[value]) }))}
              onChange={(value) => {
                if (value === 'random') setSeed(Date.now());
                setSorts((s) => ({ ...s, [section]: value }));
              }}
            />
          ) : null}
          {filterable ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: favoritesOnly }}
              accessibilityLabel={t('library.filterFavorites')}
              onPress={() => setFavoritesOnly(!favoritesOnly)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[1],
                borderWidth: 1,
                borderColor: favoritesOnly ? colors.foreground : colors.border,
                borderRadius: radius.pill,
                paddingHorizontal: space[3],
                paddingVertical: space[1],
              }}
            >
              <Icon
                name={favoritesOnly ? 'heartFilled' : 'heart'}
                color={favoritesOnly ? colors.foreground : colors.mutedForeground}
              />
              <Text
                style={{
                  color: favoritesOnly ? colors.foreground : colors.mutedForeground,
                  fontSize: type.caption.size * scale,
                }}
              >
                {t('library.filterFavorites')}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}
      {section === 'playlists' ? (
        <Button
          tone="secondary"
          title={t('playlist.new')}
          icon={<Icon name="plus" />}
          onPress={() => openDialog({ kind: 'newPlaylist' })}
        />
      ) : null}
    </View>
  );
  const empty = ready ? (
    <View style={{ paddingHorizontal: space[4] }}>
      <EmptyState
        title={
          favoritesOnly
            ? t('library.nothingMatches')
            : section === 'playlists'
              ? t('playlist.empty')
              : t('library.nothingHere')
        }
        {...(section === 'playlists' ? { description: t('playlist.emptyBody') } : {})}
        quiet={section !== 'playlists'}
      />
    </View>
  ) : null;

  if (section === 'tracks')
    return tracks.length ? (
      <TrackList testID="library-tracks" tracks={tracks} header={header} />
    ) : (
      <View>
        {header}
        {empty}
      </View>
    );

  if (section === 'genres') {
    return (
      <FlatList
        data={genres}
        keyExtractor={(g) => g.name}
        ListHeaderComponent={header}
        ListEmptyComponent={empty ?? undefined}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${t('library.tracksCount', { count: item.count })}`}
            onPress={() => router.push({ pathname: '/genre/[name]', params: { name: item.name } })}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginHorizontal: space[4],
              paddingVertical: space[3],
              borderBottomWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ color: colors.foreground, fontSize: type.body.size * scale }}>
              {item.name}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}>
              {t('library.tracksCount', { count: item.count })}
            </Text>
          </Pressable>
        )}
      />
    );
  }

  type Card = Album | Artist | Playlist;
  const data: Card[] = section === 'albums' ? albums : section === 'artists' ? artists : playlists;
  return (
    <FlatList<Card>
      testID={`library-${section}`}
      data={data}
      key={section}
      numColumns={2}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      ListEmptyComponent={empty ?? undefined}
      columnWrapperStyle={{ gap: space[4], paddingHorizontal: space[4] }}
      contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
      renderItem={({ item }) => (
        <View style={{ flex: 1 / 2 }}>
          {section === 'albums' ? (
            <AlbumCard album={item as Album} />
          ) : section === 'artists' ? (
            <ArtistCard artist={item as Artist} />
          ) : (
            <PlaylistCard playlist={item as Playlist} />
          )}
        </View>
      )}
    />
  );
}
