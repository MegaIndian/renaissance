import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { AskBar } from '@/components/AskBar';
import { Button } from '@/components/Button';
import { useTheme } from '@/lib/theme';

/** Sign-in placeholder (F1). Phase 3 wires it to JellyfinAdapter.signIn; nothing is sent here. */
export default function SignIn() {
  const { t } = useTranslation();
  const { colors, radius, type, space, scale } = useTheme();
  const field = {
    backgroundColor: colors.background,
    borderColor: colors.inputBorder,
    color: colors.foreground,
    borderRadius: radius.sm,
    fontSize: type.body.size * scale,
    paddingHorizontal: space[2] + space[1] / 2,
    paddingVertical: space[2],
  };
  const label = {
    color: colors.foreground,
    fontSize: type.label.size * scale,
    fontWeight: '500' as const,
  };
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.wrap, { backgroundColor: colors.background }]}
    >
      <View style={{ flex: 1, padding: space[4], gap: space[3] }}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: radius.md,
              padding: space[4],
              gap: space[2],
            },
          ]}
        >
          <Text style={label}>{t('signIn.serverUrl')}</Text>
          <TextInput
            accessibilityLabel={t('signIn.serverUrl')}
            placeholder={t('signIn.serverUrlHint')}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            keyboardType="url"
            style={[styles.input, field]}
          />
          <Text style={label}>{t('signIn.userName')}</Text>
          <TextInput
            accessibilityLabel={t('signIn.userName')}
            autoCapitalize="none"
            style={[styles.input, field]}
          />
          <Text style={label}>{t('signIn.password')}</Text>
          <TextInput
            accessibilityLabel={t('signIn.password')}
            secureTextEntry
            style={[styles.input, field]}
          />
          <View style={{ marginTop: space[2], gap: space[2] }}>
            <Button tone="primary" title={t('signIn.submit')} disabled />
            <Button tone="ghost" title={t('signIn.quickConnect')} disabled />
          </View>
        </View>
        <Text style={{ color: colors.mutedForeground, fontSize: type.caption.size * scale }}>
          {t('signIn.notYet')}
        </Text>
      </View>
      <View style={{ borderTopWidth: 1, borderColor: colors.border, padding: space[4] }}>
        <AskBar compact />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  card: { borderWidth: 1 },
  input: { borderWidth: 1 },
});
