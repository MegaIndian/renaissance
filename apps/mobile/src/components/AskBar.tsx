import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '@/lib/theme';

import { Icon } from './Icon';

/**
 * The one box on every screen (F75), rendered by the TabBar shell and the sign-in screen.
 * Phase 0: the input and its hint only; voice, library hits and the hub's answer come later.
 */
export function AskBar({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { colors, radius, space, type, scale } = useTheme();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const hint = value ? t('ask.noResults') : t('ask.hint');
  return (
    <View style={{ gap: space[2] }}>
      <View
        style={[
          styles.box,
          {
            backgroundColor: colors.card,
            borderColor: focused ? colors.ring : colors.border,
            borderRadius: radius.md,
            paddingHorizontal: space[3],
            paddingVertical: space[2],
            gap: space[2],
          },
        ]}
      >
        <Icon name="search" />
        <TextInput
          accessibilityLabel={t('ask.placeholder')}
          placeholder={t('ask.placeholder')}
          placeholderTextColor={colors.mutedForeground}
          value={value}
          onChangeText={setValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.input, { color: colors.foreground, fontSize: type.body.size * scale }]}
          autoCorrect={false}
          returnKeyType="search"
        />
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
  box: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  input: { flex: 1, padding: 0 },
});
