import type { Album, Artist, Playlist, SearchGroup, Track } from '@renaissance/core';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { playNow } from '@/lib/actions';
import { artistNameOf, playlistNameOf, titleOf } from '@/lib/names';
import { useLibrary, useSession } from '@/lib/queries';
import { clearRecent, recentSearchesStore, rememberRecent } from '@/lib/recent';
import { useTheme } from '@/lib/theme';
import { useStoreValue } from '@/lib/useStore';

import { Artwork } from './Artwork';
import { Icon } from './Icon';

type Hit =
  | { kind: 'track'; item: Track }
  | { kind: 'album'; item: Album }
  | { kind: 'artist'; item: Artist }
  | { kind: 'playlist'; item: Playlist }
  | { kind: 'recent'; term: string };

/**
 * The one box on every screen (F75), in the shell above the player. Phase 1 is the instant layer
 * (F11), as on web: library hits from the local index as you type, recent searches when empty; a
 * song plays, anything else opens. The results open above the box, over the screen.
 */
export function AskBar({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, radius, space, type, scale } = useTheme();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const { index, ready } = useLibrary();
  const session = useSession();
  const recent = useStoreValue(recentSearchesStore);
  const signedIn = session.status === 'signedIn';

  const groups: SearchGroup[] | null = useMemo(
    () => (signedIn && value.trim() ? index.groups(value, 4) : null),
    [index, signedIn, value],
  );
  const hits: Hit[] = useMemo(() => {
    if (!signedIn) return [];
    if (!value.trim()) return recent.map((term) => ({ kind: 'recent', term }));
    return (groups ?? []).flatMap((group): Hit[] =>
      group.kind === 'track'
        ? group.items.map((item) => ({ kind: 'track', item }) as const)
        : group.kind === 'album'
          ? group.items.map((item) => ({ kind: 'album', item }) as const)
          : group.kind === 'artist'
            ? group.items.map((item) => ({ kind: 'artist', item }) as const)
            : group.items.map((item) => ({ kind: 'playlist', item }) as const),
    );
  }, [recent, groups, signedIn, value]);

  const done = (): void => {
    if (value.trim()) rememberRecent(value);
    setValue('');
    setFocused(false);
    Keyboard.dismiss();
  };

  const choose = (hit: Hit): void => {
    switch (hit.kind) {
      case 'track':
        done();
        playNow([hit.item]);
        return;
      case 'album':
        done();
        router.push({ pathname: '/album/[id]', params: { id: hit.item.id } });
        return;
      case 'artist':
        done();
        router.push({ pathname: '/artist/[id]', params: { id: hit.item.id } });
        return;
      case 'playlist':
        done();
        router.push({ pathname: '/playlist/[id]', params: { id: hit.item.id } });
        return;
      case 'recent':
        setValue(hit.term);
        input.current?.focus();
        return;
    }
  };

  const hint = !signedIn
    ? t('ask.signInFirst')
    : value.trim() && groups && !groups.length
      ? ready
        ? t('ask.noResults')
        : t('library.syncingFirst')
      : t('ask.hintSearchOnly');
  const showList = focused && hits.length > 0;

  // As web's AskBar: songs and albums under their artist, playlists by size, artists by kind.
  const label = (hit: Exclude<Hit, { kind: 'recent' }>): { title: string; subtitle: string } => {
    switch (hit.kind) {
      case 'track':
      case 'album':
        return {
          title: titleOf(hit.item, t),
          subtitle: hit.item.artistName || t('library.unknownArtist'),
        };
      case 'artist':
        return { title: artistNameOf(hit.item, t), subtitle: t('search.artists') };
      case 'playlist':
        return {
          title: playlistNameOf(hit.item, t),
          subtitle: t('library.tracksCount', { count: hit.item.trackCount }),
        };
    }
  };

  return (
    <View style={{ gap: space[2] }}>
      {showList ? (
        <View
          accessibilityLabel={value.trim() ? t('ask.results') : t('ask.recent')}
          style={[
            styles.results,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: radius.md,
              marginBottom: space[2],
              padding: space[1],
            },
          ]}
        >
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: space[12] * 7 }}>
            {!value.trim() ? (
              <View
                style={[styles.line, { paddingHorizontal: space[2], paddingVertical: space[1] }]}
              >
                <Text
                  style={{
                    flex: 1,
                    color: colors.mutedForeground,
                    fontSize: type.caption.size * scale,
                  }}
                >
                  {t('ask.recent')}
                </Text>
                <Pressable accessibilityRole="button" onPress={clearRecent} hitSlop={space[2]}>
                  <Text
                    style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}
                  >
                    {t('ask.clearRecent')}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {hits.map((hit) => {
              const key =
                hit.kind === 'recent' ? `recent-${hit.term}` : `${hit.kind}-${hit.item.id}`;
              const text = hit.kind === 'recent' ? { title: hit.term, subtitle: '' } : label(hit);
              return (
                <Pressable
                  key={key}
                  testID={`ask-hit-${key}`}
                  accessibilityRole="button"
                  accessibilityLabel={
                    text.subtitle ? `${text.title}, ${text.subtitle}` : text.title
                  }
                  onPress={() => choose(hit)}
                  style={({ pressed }) => [
                    styles.line,
                    {
                      gap: space[3],
                      padding: space[2],
                      borderRadius: radius.sm,
                      backgroundColor: pressed ? colors.muted : 'transparent',
                    },
                  ]}
                >
                  {hit.kind === 'recent' ? (
                    <Icon name="search" />
                  ) : (
                    <View style={{ width: space[10] }}>
                      <Artwork
                        item={
                          hit.kind === 'track'
                            ? { id: hit.item.albumId ?? hit.item.id, imageId: hit.item.imageId }
                            : hit.item
                        }
                        size="sm"
                        round={hit.kind === 'artist'}
                      />
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: colors.foreground, fontSize: type.body.size * scale }}
                    >
                      {text.title}
                    </Text>
                    {text.subtitle ? (
                      <Text
                        numberOfLines={1}
                        style={{
                          color: colors.mutedForeground,
                          fontSize: type.caption.size * scale,
                        }}
                      >
                        {text.subtitle}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
      <View
        style={[
          styles.box,
          {
            backgroundColor: colors.card,
            borderColor: focused ? colors.ring : colors.inputBorder,
            borderRadius: radius.md,
            paddingHorizontal: space[3],
            paddingVertical: space[2],
            gap: space[2],
          },
        ]}
      >
        <Icon name="search" />
        <TextInput
          ref={input}
          testID="ask-input"
          accessibilityLabel={t('ask.placeholder')}
          placeholder={t('ask.placeholder')}
          placeholderTextColor={colors.mutedForeground}
          value={value}
          onChangeText={setValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={() => {
            const first = hits[0];
            if (first) choose(first);
          }}
          style={[styles.input, { color: colors.foreground, fontSize: type.body.size * scale }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('actions.close')}
            onPress={() => setValue('')}
            hitSlop={space[2]}
          >
            <Icon name="close" />
          </Pressable>
        ) : null}
      </View>
      {compact && !value ? null : (
        <Text
          numberOfLines={1}
          accessibilityLiveRegion="polite"
          style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}
        >
          {hint}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  results: { borderWidth: 1 },
  line: { flexDirection: 'row', alignItems: 'center' },
  box: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  input: { flex: 1, padding: 0 },
});
