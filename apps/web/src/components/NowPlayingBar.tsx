import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';

/** Bottom player (phase 0: nothing plays, so the Play button is muted, never a second blue). */
export function NowPlayingBar() {
  const { t } = useTranslation();
  return (
    <footer className="flex items-center gap-3 border-t border-border bg-card px-4 py-3 text-body">
      <span aria-hidden className="size-9 shrink-0 rounded-sm bg-muted" />
      <span className="min-w-0 truncate text-muted-foreground">{t('player.nothingPlaying')}</span>
      <button
        type="button"
        aria-label={t('player.play')}
        disabled
        className="ml-auto grid size-8 shrink-0 place-items-center rounded-pill bg-muted text-muted-foreground disabled:cursor-not-allowed"
      >
        <Icon name="play" className="size-4" />
      </button>
    </footer>
  );
}
