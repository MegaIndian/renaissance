import type { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';

import { AskBar } from './AskBar';
import { Icon } from './Icon';
import { NowPlayingBar } from './NowPlayingBar';
import { primaryNav } from './navigation';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/**
 * The phone shell under the screens: the Ask bar, the player, then three tabs, as the DESIGN.md
 * wireframe and web's TabBar: the same glyphs, the active one on a primary square.
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
          const icon = primaryNav.find((item) => item.name === route.name)?.icon ?? 'home';
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
                style={[
                  styles.glyph,
                  {
                    width: space[6],
                    height: space[6],
                    borderRadius: radius.sm,
                    backgroundColor: active ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Icon
                  name={icon}
                  color={active ? colors.primaryForeground : colors.mutedForeground}
                />
              </View>
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
  glyph: { alignItems: 'center', justifyContent: 'center' },
});
