import type { Settings, StreamingQuality } from '@renaissance/core';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { ScrollView, Switch, Text, View } from 'react-native';
import type { ReactNode } from 'react';

import { Button } from '@/components/Button';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SyncStatus } from '@/components/SyncStatus';
import { PageShell } from '@/components/Shell';
import { refreshLibrary } from '@/lib/library';
import { networkFor } from '@/lib/network';
import { useSession } from '@/lib/queries';
import { sessions } from '@/lib/session';
import { settingsStore, updateSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { useStoreValue } from '@/lib/useStore';

/**
 * Settings (F67 subset): account and sign-out, language, theme, streaming quality per network,
 * album-aware shuffle, the library refresh. Each change applies at once and is kept on the phone.
 */
function SettingsScreenContent() {
  const { t } = useTranslation();
  const { colors, radius, space, type, scale } = useTheme();
  const session = useSession();
  const settings = useStoreValue(settingsStore);
  const qualities: StreamingQuality[] = ['lossless', 'high', 'medium', 'low'];
  const qualityLabel: Record<StreamingQuality, string> = {
    lossless: t('settings.qualityLossless'),
    high: t('settings.qualityHigh'),
    medium: t('settings.qualityMedium'),
    low: t('settings.qualityLow'),
  };
  const kind = networkFor({ network: 'auto' });
  const kindName =
    kind === 'wifi'
      ? t('settings.networkWifiName')
      : kind === 'cellular'
        ? t('settings.networkCellularName')
        : t('settings.networkUnknownName');
  const caption = { color: colors.mutedForeground, fontSize: type.caption.size * scale };
  const label = {
    color: colors.foreground,
    fontSize: type.label.size * scale,
    fontWeight: '500' as const,
  };
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space[4], gap: space[4] }}
    >
      <Card title={t('settings.account')}>
        {session.status === 'signedIn' && session.session ? (
          <>
            <Text style={{ color: colors.foreground, fontSize: type.body.size * scale }}>
              {t('signIn.signedInAs', { name: session.session.userName })}
            </Text>
            <Text style={caption}>{session.session.server.url}</Text>
            <Text style={label}>{t('signIn.tokenStorage')}</Text>
            <Text style={caption}>
              {session.vault === 'keychain' ? t('signIn.tokenKeychain') : t('signIn.tokenUnsaved')}
            </Text>
            <Text style={caption}>{t('signIn.signOutClearsPhone')}</Text>
            <Button
              testID="sign-out"
              tone="secondary"
              title={t('signIn.signOut')}
              onPress={() => void sessions.signOut()}
            />
          </>
        ) : null}
      </Card>
      <Card title={t('settings.language')}>
        <LanguageSwitch />
      </Card>
      <Card title={t('settings.appearance')}>
        <Text style={label}>{t('settings.theme')}</Text>
        <SegmentedControl<Settings['theme']>
          label={t('settings.theme')}
          value={settings.theme}
          options={[
            { value: 'system', label: t('settings.themeSystem') },
            { value: 'dark', label: t('settings.themeDark') },
            { value: 'light', label: t('settings.themeLight') },
          ]}
          onChange={(theme) => updateSettings({ theme })}
        />
      </Card>
      <Card title={t('settings.playback')}>
        <Text style={label}>{t('settings.wifiQuality')}</Text>
        <Picker
          value={settings.wifiQuality}
          options={qualities}
          labels={qualityLabel}
          onChange={(wifiQuality) => updateSettings({ wifiQuality })}
          label={t('settings.wifiQuality')}
        />
        <Text style={label}>{t('settings.cellularQuality')}</Text>
        <Picker
          value={settings.cellularQuality}
          options={qualities}
          labels={qualityLabel}
          onChange={(cellularQuality) => updateSettings({ cellularQuality })}
          label={t('settings.cellularQuality')}
        />
        <Text style={caption}>{t('settings.qualityHelpPhone')}</Text>
        <Text style={label}>{t('settings.network')}</Text>
        <SegmentedControl<Settings['network']>
          label={t('settings.network')}
          value={settings.network}
          options={[
            { value: 'auto', label: t('settings.networkAuto') },
            { value: 'wifi', label: t('settings.networkWifi') },
            { value: 'cellular', label: t('settings.networkCellular') },
          ]}
          onChange={(network) => updateSettings({ network })}
        />
        <Text style={caption}>{t('settings.networkNow', { kind: kindName })}</Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[3],
            borderRadius: radius.sm,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={label}>{t('settings.albumAwareShuffle')}</Text>
            <Text style={caption}>{t('settings.albumAwareShuffleHelp')}</Text>
          </View>
          <Switch
            accessibilityLabel={t('settings.albumAwareShuffle')}
            value={settings.albumAwareShuffle}
            onValueChange={(albumAwareShuffle) => updateSettings({ albumAwareShuffle })}
            trackColor={{ true: colors.primary, false: colors.muted }}
          />
        </View>
      </Card>
      {session.status === 'signedIn' ? (
        <Card title={t('settings.library')}>
          <SyncStatus />
          <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
            <Button
              tone="secondary"
              title={t('library.refresh')}
              onPress={() => void refreshLibrary()}
            />
            <Button
              tone="ghost"
              title={t('library.rebuild')}
              onPress={() => void refreshLibrary({ full: true })}
            />
          </View>
        </Card>
      ) : null}
      <Card title={t('settings.about')}>
        <Text style={caption}>
          {t('settings.version', { version: Constants.expoConfig?.version ?? '0.0.0' })}
        </Text>
        <Text style={caption}>{t('settings.licence')}</Text>
      </Card>
    </ScrollView>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  const { colors, radius, space, type, scale } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: radius.md,
        padding: space[4],
        gap: space[2],
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ color: colors.foreground, fontSize: type.title.size * scale, fontWeight: '600' }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function Picker<T extends string>({
  value,
  options,
  labels,
  onChange,
  label,
}: {
  value: T;
  options: T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <SegmentedControl
        label={label}
        value={value}
        options={options.map((v) => ({ value: v, label: labels[v] }))}
        onChange={onChange}
      />
    </ScrollView>
  );
}

export default function SettingsScreen() {
  return (
    <PageShell>
      <SettingsScreenContent />
    </PageShell>
  );
}
