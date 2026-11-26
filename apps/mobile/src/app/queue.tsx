import { playedBefore, upNext } from '@renaissance/core';
import { useTranslation } from 'react-i18next';
import { Pressable, SectionList, Text, View } from 'react-native';
import type { Track } from '@renaissance/core';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import type { IconName } from '@/components/Icon';
import { Toast } from '@/components/Toast';
import { TrackRow } from '@/components/TrackRow';
import { titleOf } from '@/lib/names';
import { getPlayer } from '@/lib/player';
import { useTheme } from '@/lib/theme';
import { toast } from '@/lib/toast';
import { usePlayer } from '@/lib/usePlayer';

interface Item {
  track: Track;
  /** Position in the play order, for jump, move and remove; -1 for history rows. */
  at: number;
  key: string;
}

/**
 * The queue (F22): now playing, up next with move up, move down and remove on every song, and what
 * played earlier. Every change says what it did and can be undone.
 */
export default function QueueScreen() {
  const { t } = useTranslation();
  const { colors, radius, space, type, scale } = useTheme();
  const { queue } = usePlayer();
  const player = getPlayer();
  const current = queue.items[queue.index];
  const next = upNext(queue);
  const offset = queue.index < 0 ? 0 : queue.index + 1;
  const history = playedBefore(queue).slice(-20).reverse();
  if (!queue.items.length) {
    return (
      <View style={{ flex: 1, padding: space[4], backgroundColor: colors.background }}>
        <EmptyState title={t('queue.empty')} description={t('queue.emptyBody')} />
      </View>
    );
  }
  const sections = [
    ...(current
      ? [
          {
            title: t('queue.nowPlaying'),
            data: [{ track: current, at: queue.index, key: `now-${queue.keys[queue.index]}` }],
          },
        ]
      : []),
    {
      title: `${t('queue.upNext')} · ${t('queue.count', { count: next.length })}`,
      data: next.map((track, i) => ({
        track,
        at: offset + i,
        key: `next-${queue.keys[offset + i]}`,
      })),
    },
    ...(history.length
      ? [
          {
            title: t('queue.history'),
            data: history.map((track, i) => ({ track, at: -1, key: `history-${i}-${track.id}` })),
          },
        ]
      : []),
  ];
  const move = (from: number, to: number, track: Track): void => {
    player.move(from, to);
    toast(t('playlist.reorderedTo', { title: titleOf(track, t), position: to - offset + 1 }), {
      undo: () => player.move(to, from),
    });
  };
  const small = (icon: IconName, label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={space[1]}
      style={{
        width: space[8],
        height: space[8],
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon name={icon} />
    </Pressable>
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionList<Item>
        testID="queue-list"
        sections={sections}
        keyExtractor={(item) => item.key}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={{ padding: space[4], flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Button
              tone="ghost"
              title={t('queue.clear')}
              onPress={() => {
                const before = queue;
                const position = player.snapshot.position;
                player.clear();
                toast(t('queue.cleared'), { undo: () => player.restore(before, position) });
              }}
            />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text
            accessibilityRole="header"
            style={{
              color: colors.mutedForeground,
              fontSize: type.label.size * scale,
              fontWeight: '500',
              paddingHorizontal: space[4],
              paddingTop: space[3],
              paddingBottom: space[1],
            }}
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item, index }) => {
          const upcoming = item.at > queue.index;
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: space[2] }}>
              <View style={{ flex: 1 }}>
                <TrackRow
                  track={item.track}
                  index={index}
                  onPlay={() =>
                    item.at >= 0 ? player.jumpTo(item.at) : player.playNext([item.track])
                  }
                />
              </View>
              {upcoming ? (
                <>
                  {small(
                    'chevronUp',
                    t('queue.moveUp'),
                    () => move(item.at, item.at - 1, item.track),
                    item.at <= offset,
                  )}
                  {small(
                    'chevronDown',
                    t('queue.moveDown'),
                    () => move(item.at, item.at + 1, item.track),
                    item.at >= queue.items.length - 1,
                  )}
                  {small('close', t('queue.remove'), () => {
                    const before = queue;
                    player.removeAt(item.at);
                    toast(t('queue.removed', { title: titleOf(item.track, t) }), {
                      undo: () => player.revert(before),
                    });
                  })}
                </>
              ) : null}
            </View>
          );
        }}
      />
      <Toast />
    </View>
  );
}
