import type { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

import { AskBar } from './AskBar';
import { NowPlayingBar } from './NowPlayingBar';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/**
 * The phone shell under the screens: the Ask bar, the player, then three tabs, as the DESIGN.md
 * wireframe and web's TabBar. The active tab's glyph fills with the primary.
 */
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: TabBarProps) {
  const { t } = useTranslation();
  const { colors, radius, space, type, scale } = useTheme();
  return (
    <View style={{ backgroundColor: colors.card }}>
      <View
        style={{
          borderTopWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: space[4],
          paddingVertical: space[2],
        }}
      >
        <AskBar compact />
      </View>
      <NowPlayingBar />
      <View
        accessibilityRole="tablist"
        accessibilityLabel={t('nav.primary')}
        style={[
          styles.tabs,
          {
            borderColor: colors.border,
            paddingTop: space[2],
            paddingBottom: Math.max(insets.bottom, space[3]),
            paddingHorizontal: space[2],
          },
        ]}
      >
        {state.routes.map((route, index) => {
          const active = state.index === index;
          const options = descriptors[route.key]?.options;
          const label = typeof options?.title === 'string' ? options.title : route.name;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={label}
              onPress={() => {
                const event = emitter.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!active && !event.defaultPrevented) navigateToTab(route.key);
              }}
              style={[styles.tab, { paddingVertical: space[1], gap: space[1] }]}
            >
              <View
                style={{
                  width: space[6],
                  height: space[6],
                  borderRadius: radius.sm,
                  borderWidth: active ? 0 : 1.5,
                  borderColor: colors.mutedForeground,
                  backgroundColor: active ? colors.primary : 'transparent',
                }}
              />
              <Text
                numberOfLines={1}
                style={{
                  color: active ? colors.foreground : colors.mutedForeground,
                  fontSize: type.caption.size * scale,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1 },
  tab: { alignItems: 'center', minWidth: 64 },
});
