import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '@/lib/theme';

/** The one box on every screen (F75). Phase 0: the input and its hint only. */
export function AskBar() {
  const { t } = useTranslation();
  const { colors, radius, type, scale } = useTheme();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.box,
          {
            backgroundColor: colors.card,
            borderColor: focused ? colors.ring : colors.border,
            borderRadius: radius.md,
          },
        ]}
      >
        <View style={[styles.dot, { borderColor: colors.mutedForeground }]} />
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
      <Text style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}>
        {value ? t('ask.noResults') : t('ask.hint')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  input: { flex: 1, padding: 0 },
});
