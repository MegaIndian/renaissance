import { useTranslation } from 'react-i18next';

import { AskBar } from '../components/AskBar';
import { PlaceholderArt } from '../components/PlaceholderArt';

/** Simple-mode home (F84): greeting, the Ask bar, three rows. Placeholders until phase 1. */
export function Home() {
  const { t } = useTranslation();
  const rows = [t('home.mySongs'), t('home.recent'), t('home.mixes')];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('home.greeting', { name: 'Sahil' })}
      </h1>
      <AskBar autoFocus />
      {rows.map((title, r) => (
        <section key={title} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1">
                <PlaceholderArt index={r * 2 + i} />
                <div className="truncate text-[13px] font-medium">—</div>
                <div className="truncate text-[11px] text-muted-foreground">{t('home.empty')}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="text-[11px] text-muted-foreground">{t('status.preAlpha')}</p>
    </div>
  );
}
