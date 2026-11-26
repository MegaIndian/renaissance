import { supportedLanguages } from '@renaissance/core/i18n';
import type { Language } from '@renaissance/core/i18n';
import type { Settings as SettingsValue, StreamingQuality } from '@renaissance/core';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { clearHistory, restoreHistory, useHistory } from '../lib/history';
import { setLanguage } from '../lib/i18n';
import { refreshLibrary } from '../lib/library';
import { useSettings } from '../lib/mode';
import { networkFor } from '../lib/network';
import { useLibrary, useSession } from '../lib/queries';
import { signOut } from '../lib/session';
import { updateSettings } from '../lib/settings';
import { toast } from '../lib/toast';
import { Button, LinkButton } from '../components/Button';
import { SegmentedControl } from '../components/SegmentedControl';
import { SyncStatus } from '../components/SyncStatus';
import { focusRing } from '../components/focus';

declare const __APP_VERSION__: string;

/**
 * Settings (F67 shape, F84 switch, F27 quality, F5 token note): mode, appearance, language, playback
 * quality per network, album-aware shuffle, account and sign-out, library refresh, the listening
 * history switch and clear (F47), about.
 */
export function Settings() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const session = useSession();
  const { snapshot, ready, sync } = useLibrary();
  const history = useHistory();
  // No count line while the cache is read or the first sync runs over an empty cache: it would say 0.
  const showCount =
    ready &&
    sync.status !== 'loading' &&
    !(sync.status === 'syncing' && !snapshot.syncedAt) &&
    !(sync.status === 'error' && !snapshot.syncedAt);
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
        <Captioned id="theme-label" label={t('settings.theme')}>
          <SegmentedControl
            label={t('settings.theme')}
            labelledBy="theme-label"
            value={settings.theme}
            options={[
              { value: 'system', label: t('settings.themeSystem') },
              { value: 'dark', label: t('settings.themeDark') },
              { value: 'light', label: t('settings.themeLight') },
            ]}
            onChange={(theme: SettingsValue['theme']) => updateSettings({ theme })}
          />
        </Captioned>
        <Captioned id="language-label" label={t('settings.language')}>
          <SegmentedControl
            label={t('settings.language')}
            labelledBy="language-label"
            value={language}
            options={supportedLanguages.map((lng) => ({ value: lng, label: t(`language.${lng}`) }))}
            onChange={(lng: Language) => {
              // The choice is stored once the strings are in; a failed fetch leaves it as it was.
              void setLanguage(lng).then((ok) => {
                if (ok) updateSettings({ language: lng });
              });
            }}
          />
        </Captioned>
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
        <Captioned id="network-label" label={t('settings.network')}>
          <SegmentedControl
            label={t('settings.network')}
            labelledBy="network-label"
            value={settings.network}
            options={[
              { value: 'auto', label: t('settings.networkAuto') },
              { value: 'wifi', label: t('settings.networkWifi') },
              { value: 'cellular', label: t('settings.networkCellular') },
            ]}
            onChange={(network: SettingsValue['network']) => updateSettings({ network })}
          />
        </Captioned>
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
          {showCount ? (
            <p className="text-caption text-muted-foreground">
              {[
                t('library.tracksCount', { count: snapshot.tracks.length }),
                t('library.albumsCount', { count: snapshot.albums.length }),
                t('library.artistsCount', { count: snapshot.artists.length }),
              ].join(' · ')}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <Button tone="secondary" onClick={() => void refreshLibrary({ full: true })}>
              {t('library.rebuild')}
            </Button>
            <SyncStatus />
          </div>
        </Section>
      ) : null}

      {session.status === 'signedIn' ? (
        <Section title={t('settings.history')}>
          <label className="flex items-start gap-3 text-body" htmlFor="listening-log">
            <span className="grid size-6 shrink-0 place-items-center">
              <input
                id="listening-log"
                type="checkbox"
                checked={settings.listeningLog}
                onChange={(e) => updateSettings({ listeningLog: e.target.checked })}
                className={`size-4 accent-primary ${focusRing}`}
              />
            </span>
            <span className="flex flex-col">
              <span className="font-medium">{t('settings.listeningLog')}</span>
              <span className="text-caption text-muted-foreground">
                {t('settings.listeningLogHelp')}
              </span>
            </span>
          </label>
          {history.ready ? (
            <p className="text-caption text-muted-foreground">
              {t('history.playsCount', { count: history.count })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <LinkButton to="/history" tone="secondary">
              {t('settings.openHistory')}
            </LinkButton>
            <Button
              tone="secondary"
              disabled={!history.ready || history.count === 0}
              onClick={() => void clearWithUndo(t)}
            >
              {t('settings.clearHistory')}
            </Button>
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

/** Clear the listening log; the toast says how many plays went and its undo puts them back. */
async function clearWithUndo(t: TFunction): Promise<void> {
  const failed = () => toast(t('error.failed'), { tone: 'danger' });
  try {
    const removed = await clearHistory();
    if (!removed) return;
    toast(t('history.cleared', { count: removed.length }), {
      undo: () => void restoreHistory(removed).catch(failed),
    });
  } catch {
    failed();
  }
}

/** A visible caption over a control group, the same `text-label` the quality selects carry (design AC). */
function Captioned({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span id={id} className="text-label font-medium">
        {label}
      </span>
      {children}
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
