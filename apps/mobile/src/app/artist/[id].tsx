import { sortItems } from '@renaissance/core';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useLayoutEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { AlbumCard, ArtistCard } from '@/components/Cards';
import { EmptyState } from '@/components/EmptyState';
import { FavoriteButton } from '@/components/FavoriteButton';
import { Grid } from '@/components/Grid';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { Row, RowItem } from '@/components/Row';
import { TrackRow } from '@/components/TrackRow';
import { PageShell } from '@/components/Shell';
import { playNow, toggleFavorite } from '@/lib/actions';
import { openTrackMenu } from '@/lib/menu';
import { artistNameOf } from '@/lib/names';
import {
  isNotFound,
  useArtist,
  useArtistItems,
  useSimilarArtists,
  useSnapshot,
} from '@/lib/queries';
import { useTheme } from '@/lib/theme';

/** Artist page (F10): biography, albums, singles and EPs, songs, appears on, similar artists. */
function ArtistPageContent() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, space, type, scale } = useTheme();
  const { artist, isLoading, error } = useArtist(id);
  const similar = useSimilarArtists(artist?.id ?? id);
  const snapshot = useSnapshot();
  const items = useArtistItems(artist);
  const [bioOpen, setBioOpen] = useState(false);
  const albums = useMemo(() => sortItems(items.albums, 'year'), [items.albums]);
  const tracks = useMemo(() => sortItems(items.tracks, 'playCount'), [items.tracks]);
  const appearsOn = useMemo(() => {
    const own = new Set(albums.map((a) => a.id));
    return snapshot.albums.filter((a) => !own.has(a.id) && tracks.some((x) => x.albumId === a.id));
  }, [snapshot.albums, tracks, albums]);
  const name = artist ? artistNameOf(artist, t) : '';
  useLayoutEffect(() => {
    if (name) navigation.setOptions({ title: name });
  }, [navigation, name]);
  if (!artist) {
    return (
      <View style={{ padding: space[4] }}>
        {isLoading ? (
          <Text style={{ color: colors.mutedForeground }}>{t('player.loading')}</Text>
        ) : (
          <EmptyState
            title={t(error && !isNotFound(error) ? 'error.unreachable' : 'artist.notFound')}
            quiet
          />
        )}
      </View>
    );
  }
  const full = albums.filter((a) => (a.trackCount ?? 0) > 6);
  const singles = albums.filter((a) => (a.trackCount ?? 0) <= 6);
  const bio = artist.bio?.trim();
  const shortBio = bio && bio.length > 280 && !bioOpen ? `${bio.slice(0, 280).trimEnd()}…` : bio;
  const heading = (text: string) => (
    <Text
      accessibilityRole="header"
      style={{ color: colors.foreground, fontSize: type.heading.size * scale, fontWeight: '600' }}
    >
      {text}
    </Text>
  );
  const topTracks = tracks.slice(0, 10);
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: space[6] }}
    >
      <PageHeader
        item={artist}
        round
        title={name}
        lines={[t('library.tracksCount', { count: tracks.length })]}
      >
        <Button
          tone="primary"
          title={t('artist.playAll')}
          icon={<Icon name="play" color={colors.primaryForeground} />}
          disabled={!tracks.length}
          onPress={() => playNow(tracks, 0)}
        />
        <Button
          tone="secondary"
          title={t('artist.shuffleAll')}
          icon={<Icon name="shuffle" />}
          disabled={!tracks.length}
          onPress={() => playNow(sortItems(tracks, 'random', 'asc', Date.now()), 0)}
        />
        <FavoriteButton kind="artist" item={artist} />
      </PageHeader>
      <View style={{ paddingHorizontal: space[4], gap: space[6] }}>
        {shortBio ? (
          <View style={{ gap: space[2] }}>
            {heading(t('artist.bio'))}
            <Text style={{ color: colors.mutedForeground, fontSize: type.body.size * scale }}>
              {shortBio}
            </Text>
            {bio && bio.length > 280 ? (
              <Pressable accessibilityRole="button" onPress={() => setBioOpen(!bioOpen)}>
                <Text
                  style={{
                    color: colors.foreground,
                    fontSize: type.body.size * scale,
                    fontWeight: '500',
                  }}
                >
                  {bioOpen ? t('artist.bioLess') : t('artist.bioMore')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {topTracks.length ? (
          <View>
            {heading(t('artist.topTracks'))}
            {topTracks.map((track, i) => (
              <TrackRow
                key={track.id}
                track={track}
                index={i}
                onPlay={() => playNow(tracks, i)}
                onToggleFavorite={() => void toggleFavorite('track', track, t)}
                onMenu={() => openTrackMenu({ track })}
              />
            ))}
          </View>
        ) : null}
        {full.length ? (
          <View style={{ gap: space[3] }}>
            {heading(t('artist.albums'))}
            <Grid>
              {full.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </Grid>
          </View>
        ) : null}
        {singles.length ? (
          <View style={{ gap: space[3] }}>
            {heading(t('artist.singles'))}
            <Grid>
              {singles.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </Grid>
          </View>
        ) : null}
        {appearsOn.length ? (
          <View style={{ gap: space[3] }}>
            {heading(t('artist.appearsOn'))}
            <Grid>
              {appearsOn.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </Grid>
          </View>
        ) : null}
        {similar.data?.length ? (
          <Row title={t('artist.similar')} empty="" count={similar.data.length}>
            {similar.data.map((a) => (
              <RowItem key={a.id}>
                <ArtistCard artist={a} />
              </RowItem>
            ))}
          </Row>
        ) : null}
      </View>
    </ScrollView>
  );
}

export default function ArtistPage() {
  return (
    <PageShell>
      <ArtistPageContent />
    </PageShell>
  );
}
