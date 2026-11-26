import { greetingKey, sortItems } from '@renaissance/core';
import type { Track } from '@renaissance/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';

import { Button, LinkButton } from '@/components/Button';
import { TrackCard } from '@/components/Cards';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Row, RowItem } from '@/components/Row';
import { SyncStatus } from '@/components/SyncStatus';
import { playNow } from '@/lib/actions';
import { useLibrary, useRecentlyPlayed, useSession } from '@/lib/queries';
import { useTheme } from '@/lib/theme';

/**
 * Simple-mode home (F7, F84), mirroring web: greeting and three rows (My songs, Recently played,
 * Made for you) in big type. Signed out, one EmptyState carries the only primary action: Sign in.
 */
export default function Home() {
  const { t } = useTranslation();
  const { colors, radius, type, space, scale } = useTheme();
  const session = useSession();
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
  const signedIn = session.status === 'signedIn' ? session.session : null;
  const greeting = signedIn
    ? t('home.greetingWithName', { greeting: t(greetingKey()), name: signedIn.userName })
    : t(greetingKey());
  const heading = (
    <Text
      accessibilityRole="header"
      style={{ color: colors.foreground, fontSize: type.display.size * scale, fontWeight: '600' }}
    >
      {greeting}
    </Text>
  );

  if (!signedIn) {
    const rows = [
      { title: t('home.mySongs'), empty: t('home.mySongsEmpty') },
      { title: t('home.recent'), empty: t('home.recentEmpty') },
      { title: t('home.mixes'), empty: t('home.mixesEmpty') },
    ];
    return (
      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[6] }}
        style={{ backgroundColor: colors.background }}
      >
        {heading}
        {session.status === 'signedOut' ? (
          <EmptyState
            title={t('home.empty')}
            description={t('home.emptyBody')}
            art={
              <View
                accessibilityElementsHidden
                style={{
                  width: space[12],
                  height: space[12],
                  borderRadius: radius.pill,
                  backgroundColor: colors.muted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="person" size={space[6]} />
              </View>
            }
            action={<LinkButton href="/sign-in" tone="primary" title={t('signIn.submit')} />}
          />
        ) : null}
        {rows.map((row) =>
          session.status === 'loading' ? (
            <Row key={row.title} title={row.title} empty={row.empty} count={0} pending>
              {null}
            </Row>
          ) : (
            <View key={row.title} style={{ gap: space[2] }}>
              <Text
                accessibilityRole="header"
                style={{
                  color: colors.foreground,
                  fontSize: type.heading.size * scale,
                  fontWeight: '600',
                }}
              >
                {row.title}
              </Text>
              <EmptyState title={row.empty} quiet />
            </View>
          ),
        )}
        <Text style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}>
          {t('status.preAlpha')}
        </Text>
      </ScrollView>
    );
  }

  const trackRow = (tracks: Track[]) =>
    tracks.map((track, i) => (
      <RowItem key={track.id}>
        <TrackCard track={track} onPlay={() => playNow(tracks, i)} />
      </RowItem>
    ));

  return (
    <ScrollView
      contentContainerStyle={{ padding: space[4], gap: space[6] }}
      style={{ backgroundColor: colors.background }}
    >
      <View style={{ gap: space[1] }}>
        {heading}
        <SyncStatus />
      </View>
      <Row
        title={t('home.mySongs')}
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
      <View style={{ gap: space[2] }}>
        <Text
          accessibilityRole="header"
          style={{
            color: colors.foreground,
            fontSize: type.heading.size * scale,
            fontWeight: '600',
          }}
        >
          {t('home.mixes')}
        </Text>
        <EmptyState title={t('home.mixesEmpty')} quiet />
      </View>
      {snapshot.tracks.length ? (
        <Button
          tone="secondary"
          title={t('home.shuffleAll')}
          icon={<Icon name="shuffle" />}
          onPress={() => playNow(sortItems(snapshot.tracks, 'random', 'asc', Date.now()))}
        />
      ) : null}
    </ScrollView>
  );
}
