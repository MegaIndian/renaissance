import { formatDuration } from '@renaissance/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native';

import { getPlayer } from '@/lib/player';
import { useTheme } from '@/lib/theme';
import { usePlayer } from '@/lib/usePlayer';

import { Icon } from './Icon';
import type { IconName } from './Icon';

/** A round transport button; `primary` is the one blue on the now-playing screen (Play). */
export function RoundButton({
  icon,
  label,
  onPress,
  tone = 'ghost',
  active = false,
  size = 'md',
  disabled = false,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'ghost';
  active?: boolean;
  size?: 'md' | 'lg';
  disabled?: boolean;
  testID?: string;
}) {
  const { colors, radius, space } = useTheme();
  const box = size === 'lg' ? space[12] + space[2] : space[8] + space[2];
  const fill = tone === 'primary' && !disabled ? colors.primary : 'transparent';
  const ink =
    tone === 'primary' && !disabled
      ? colors.primaryForeground
      : active
        ? colors.foreground
        : colors.mutedForeground;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.round,
        {
          width: box,
          height: box,
          borderRadius: radius.pill,
          backgroundColor: fill,
          borderWidth: active ? 1 : 0,
          borderColor: colors.border,
        },
      ]}
    >
      <Icon name={icon} color={ink} size={size === 'lg' ? space[6] : space[5]} />
    </Pressable>
  );
}

/** Shuffle, previous, play or pause, next, repeat: web's TransportControls. */
export function TransportControls() {
  const { t } = useTranslation();
  const { space } = useTheme();
  const { status, queue } = usePlayer();
  const player = getPlayer();
  const playing = status === 'playing' || status === 'loading';
  const empty = queue.index < 0;
  const repeatLabel =
    queue.repeat === 'one'
      ? t('player.repeatOne')
      : queue.repeat === 'all'
        ? t('player.repeatAll')
        : t('player.repeatOff');
  return (
    <View style={[styles.row, { gap: space[3] }]}>
      <RoundButton
        icon="shuffle"
        label={queue.shuffle ? t('player.shuffleOn') : t('player.shuffleOff')}
        active={queue.shuffle}
        onPress={() => player.setShuffle(!queue.shuffle)}
        disabled={empty}
      />
      <RoundButton
        icon="previous"
        label={t('player.previous')}
        onPress={() => player.previous()}
        disabled={empty}
      />
      <RoundButton
        testID="now-playing-toggle"
        icon={playing ? 'pause' : 'play'}
        label={playing ? t('player.pause') : t('player.play')}
        tone="primary"
        size="lg"
        onPress={() => player.toggle()}
        disabled={empty}
      />
      <RoundButton
        icon="next"
        label={t('player.next')}
        onPress={() => player.next()}
        disabled={empty}
      />
      <RoundButton
        icon={queue.repeat === 'one' ? 'repeatOne' : 'repeat'}
        label={repeatLabel}
        active={queue.repeat !== 'off'}
        onPress={() => player.cycleRepeat()}
        disabled={empty}
      />
    </View>
  );
}

/** Position and duration with a bar to tap or drag (F24 "chapter-free seek"). */
export function Scrubber() {
  const { t } = useTranslation();
  const { colors, radius, space, type, scale } = useTheme();
  const { position, duration } = usePlayer();
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? position;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;
  const at = (event: GestureResponderEvent): number =>
    width > 0 ? Math.min(1, Math.max(0, event.nativeEvent.locationX / width)) * duration : 0;
  const step = Math.max(5, Math.round(duration / 20));
  return (
    <View style={{ gap: space[1] }}>
      <View
        testID="scrubber"
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('player.seek')}
        accessibilityValue={{
          min: 0,
          max: Math.round(duration),
          now: Math.round(shown),
          text: formatDuration(shown),
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          const delta = event.nativeEvent.actionName === 'increment' ? step : -step;
          getPlayer().seek(position + delta);
        }}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => duration > 0}
        onMoveShouldSetResponder={() => duration > 0}
        onResponderGrant={(event) => setDragging(at(event))}
        onResponderMove={(event) => setDragging(at(event))}
        onResponderRelease={(event) => {
          getPlayer().seek(at(event));
          setDragging(null);
        }}
        onResponderTerminate={() => setDragging(null)}
        style={{ paddingVertical: space[2] }}
      >
        <View
          style={{ height: space[1], borderRadius: radius.pill, backgroundColor: colors.muted }}
        >
          <View
            style={{
              width: `${fraction * 100}%`,
              height: '100%',
              borderRadius: radius.pill,
              backgroundColor: colors.foreground,
            }}
          />
        </View>
      </View>
      <View style={styles.times}>
        <Text style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}>
          {formatDuration(shown)}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}>
          {formatDuration(duration)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  round: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
});
