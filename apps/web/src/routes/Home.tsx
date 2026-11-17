import { greetingKey } from '@renaissance/core';
import { useTranslation } from 'react-i18next';

import { LinkButton } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { PlaceholderArt } from '../components/PlaceholderArt';

/**
 * Simple-mode home (F84): greeting and three rows. Signed out (all of phase 0), each row is one
 * EmptyState with a full sentence and the one primary on the screen is Sign in.
 */
export function Home({ now = new Date() }: { now?: Date }) {
  const { t } = useTranslation();
  const rows = [
    { title: t('home.mySongs'), empty: t('home.mySongsEmpty') },
    { title: t('home.recent'), empty: t('home.recentEmpty') },
    { title: t('home.mixes'), empty: t('home.mixesEmpty') },
  ];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-display font-semibold tracking-tight">{t(greetingKey(now))}</h1>
      <EmptyState
        title={t('home.empty')}
        description={t('home.emptyBody')}
        art={<PlaceholderArt index={1} size="sm" />}
        action={
          <LinkButton to="/sign-in" tone="primary" className="shrink-0">
            {t('signIn.submit')}
          </LinkButton>
        }
      />
      {rows.map((row) => (
        <section key={row.title} className="flex flex-col gap-2">
          <h2 className="text-heading font-semibold">{row.title}</h2>
          <EmptyState title={row.empty} quiet />
        </section>
      ))}
      <p className="text-caption text-muted-foreground">{t('status.preAlpha')}</p>
    </div>
  );
}
