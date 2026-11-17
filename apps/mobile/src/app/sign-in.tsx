import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '@/lib/theme';

/** Sign-in placeholder (F1). Phase 3 wires it to JellyfinAdapter.signIn; nothing is sent here. */
export default function SignIn() {
  const { t } = useTranslation();
  const { colors, radius, type, scale } = useTheme();
  const field = {
    backgroundColor: colors.background,
    borderColor: colors.border,
    color: colors.foreground,
    borderRadius: radius.sm,
    fontSize: type.body.size * scale,
  };
  return (
    <View style={[styles.wrap, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md },
        ]}
      >
        <Text
          style={{ color: colors.foreground, fontSize: type.label.size * scale, fontWeight: '500' }}
        >
          {t('signIn.serverUrl')}
        </Text>
        <TextInput
          accessibilityLabel={t('signIn.serverUrl')}
          placeholder={t('signIn.serverUrlHint')}
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          keyboardType="url"
          style={[styles.input, field]}
        />
        <Text
          style={{ color: colors.foreground, fontSize: type.label.size * scale, fontWeight: '500' }}
        >
          {t('signIn.userName')}
        </Text>
        <TextInput
          accessibilityLabel={t('signIn.userName')}
          autoCapitalize="none"
          style={[styles.input, field]}
        />
        <Text
          style={{ color: colors.foreground, fontSize: type.label.size * scale, fontWeight: '500' }}
        >
          {t('signIn.password')}
        </Text>
        <TextInput
          accessibilityLabel={t('signIn.password')}
          secureTextEntry
          style={[styles.input, field]}
        />
        <Pressable
          disabled
          accessibilityRole="button"
          style={[
            styles.button,
            { backgroundColor: colors.primary, borderRadius: radius.sm, opacity: 0.5 },
          ]}
        >
          <Text
            style={{
              color: colors.primaryForeground,
              fontSize: type.body.size * scale,
              fontWeight: '500',
            }}
          >
            {t('signIn.submit')}
          </Text>
        </Pressable>
      </View>
      <Text style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}>
        {t('signIn.notYet')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  card: { borderWidth: 1, padding: 16, gap: 8 },
  input: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  button: { alignItems: 'center', paddingVertical: 10, marginTop: 8 },
});
