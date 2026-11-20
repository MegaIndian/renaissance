import { supportedLanguages } from '@renaissance/core/i18n';
import type { Language } from '@renaissance/core/i18n';
import type { Settings as SettingsValue, StreamingQuality } from '@renaissance/core';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { setLanguage } from '../lib/i18n';
import { refreshLibrary } from '../lib/library';
import { useSettings } from '../lib/mode';
import { networkFor } from '../lib/network';
import { useLibrary, useSession } from '../lib/queries';
import { signOut } from '../lib/session';
import { updateSettings } from '../lib/settings';
import { Button } from '../components/Button';
import { SegmentedControl } from '../components/SegmentedControl';
import { SyncStatus } from '../components/SyncStatus';
import { focusRing } from '../components/focus';

declare const __APP_VERSION__: string;

/**
 * Settings (F67 shape, F84 switch, F27 quality, F5 token note): mode, appearance, language, playback
 * quality per network, album-aware shuffle, account and sign-out, library refresh, about.
 */
export function Settings() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const session = useSession();
  const { snapshot } = useLibrary();
  const navigate = useNavigate();
  const language = (supportedLanguages as readonly string[]).includes(i18n.language)
    ? (i18n.language as Language)
    : 'en';
  const qualityOptions: { value: StreamingQuality; label: string }[] = [
    { value: 'lossless', label: t('settings.qualityLossless') },
    { value: 'high', label: t('settings.qualityHigh') },
    { value: 'medium', label: t('settings.qualityMedium') },
    { value: 'low', label: t('settings.qualityLow') },
  ];
  // The class playback uses right now, the override included.
  const network = networkFor(settings);
  const networkName =
    network === 'wifi'
      ? t('settings.networkWifiName')
      : network === 'cellular'
        ? t('settings.networkCellularName')
        : t('settings.networkUnknownName');
  const select = (
    id: string,
    label: string,
    value: string,
    options: { value: string; label: string }[],
    onChange: (v: string) => void,
  ) => (
    <label className="flex flex-col gap-1 text-label font-medium" htmlFor={id}>
      {label}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`min-h-6 min-w-0 max-w-full rounded-sm border border-input-border bg-background px-2 py-1.5 text-body font-normal text-foreground ${focusRing}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-heading font-semibold">{t('settings.title')}</h1>

      <Section title={t('settings.mode')}>
        <SegmentedControl
          label={t('settings.mode')}
          value={settings.mode}
          options={[
            { value: 'simple', label: t('settings.modeSimple') },
            { value: 'advanced', label: t('settings.modeAdvanced') },
          ]}
          onChange={(mode: SettingsValue['mode']) => updateSettings({ mode })}
        />
        <p className="text-caption text-muted-foreground">{t('settings.modeHelp')}</p>
      </Section>

      <Section title={t('settings.appearance')}>
        <SegmentedControl
          label={t('settings.theme')}
          value={settings.theme}
          options={[
            { value: 'system', label: t('settings.themeSystem') },
            { value: 'dark', label: t('settings.themeDark') },
            { value: 'light', label: t('settings.themeLight') },
          ]}
          onChange={(theme: SettingsValue['theme']) => updateSettings({ theme })}
        />
        <SegmentedControl
          label={t('settings.language')}
          value={language}
          options={supportedLanguages.map((lng) => ({ value: lng, label: t(`language.${lng}`) }))}
          onChange={(lng: Language) => {
            // The choice is stored once the strings are in; a failed fetch leaves it as it was.
            void setLanguage(lng).then((ok) => {
              if (ok) updateSettings({ language: lng });
            });
          }}
        />
      </Section>

      <Section title={t('settings.playback')}>
        {select(
          'wifi-quality',
          t('settings.wifiQuality'),
          settings.wifiQuality,
          qualityOptions,
          (v) => updateSettings({ wifiQuality: v as StreamingQuality }),
        )}
        {select(
          'cellular-quality',
          t('settings.cellularQuality'),
          settings.cellularQuality,
          qualityOptions,
          (v) => updateSettings({ cellularQuality: v as StreamingQuality }),
        )}
        <p className="text-caption text-muted-foreground">{t('settings.qualityHelp')}</p>
        <SegmentedControl
          label={t('settings.network')}
          value={settings.network}
          options={[
            { value: 'auto', label: t('settings.networkAuto') },
            { value: 'wifi', label: t('settings.networkWifi') },
            { value: 'cellular', label: t('settings.networkCellular') },
          ]}
          onChange={(network: SettingsValue['network']) => updateSettings({ network })}
        />
        <p className="text-caption text-muted-foreground">
          {t('settings.networkNow', { kind: networkName })}
        </p>
        <label className="flex items-start gap-3 text-body" htmlFor="album-aware">
          <span className="grid size-6 shrink-0 place-items-center">
            <input
              id="album-aware"
              type="checkbox"
              checked={settings.albumAwareShuffle}
              onChange={(e) => updateSettings({ albumAwareShuffle: e.target.checked })}
              className={`size-4 accent-primary ${focusRing}`}
            />
          </span>
          <span className="flex flex-col">
            <span className="font-medium">{t('settings.albumAwareShuffle')}</span>
            <span className="text-caption text-muted-foreground">
              {t('settings.albumAwareShuffleHelp')}
            </span>
          </span>
        </label>
      </Section>

      <Section title={t('settings.account')}>
        {session.status === 'signedIn' && session.session ? (
          <>
            <p className="text-body">
              {t('signIn.signedInAs', { name: session.session.userName })}
            </p>
            <p className="text-caption text-muted-foreground">
              {t('settings.server')}: {session.session.server.url}
            </p>
            <p className="text-caption text-muted-foreground">
              {t('signIn.tokenStorage')}:{' '}
              {session.vault === 'plain'
                ? t('signIn.tokenPlain')
                : session.vault === 'none'
                  ? t('signIn.tokenNone')
                  : t('signIn.tokenEncrypted')}
            </p>
            <p className="text-caption text-muted-foreground">{t('signIn.signOutClears')}</p>
            <p className="text-caption text-muted-foreground">{t('signIn.perPerson')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                tone="secondary"
                onClick={() => {
                  void signOut().then(() => navigate('/sign-in'));
                }}
              >
                {t('signIn.signOut')}
              </Button>
            </div>
          </>
        ) : (
          <Button tone="primary" onClick={() => void navigate('/sign-in')}>
            {t('signIn.submit')}
          </Button>
        )}
      </Section>

      {session.status === 'signedIn' ? (
        <Section title={t('settings.library')}>
          <p className="text-caption text-muted-foreground">
            {[
              t('library.tracksCount', { count: snapshot.tracks.length }),
              t('library.albumsCount', { count: snapshot.albums.length }),
              t('library.artistsCount', { count: snapshot.artists.length }),
            ].join(' · ')}
          </p>
          <div className="flex items-center gap-3">
            <Button tone="secondary" onClick={() => void refreshLibrary({ full: true })}>
              {t('library.rebuild')}
            </Button>
            <SyncStatus />
          </div>
        </Section>
      ) : null}

      <Section title={t('settings.about')}>
        <p className="text-body">
          {t('settings.version', {
            version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
          })}
        </p>
        <p className="text-caption text-muted-foreground">{t('settings.licence')}</p>
        {settings.mode === 'advanced' ? (
          <p className="text-caption text-muted-foreground">{t('settings.diagnosticsLater')}</p>
        ) : null}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
      aria-label={title}
    >
      <h2 className="text-title font-semibold">{title}</h2>
      {children}
    </section>
  );
}
