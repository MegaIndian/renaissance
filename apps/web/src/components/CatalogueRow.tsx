import { formatDuration, splitTitleVersion } from '@renaissance/core';
import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { CatalogueRow, RowStatus } from '../lib/hub';
import { rowStatusText } from '../lib/hub';
import { Icon } from './Icon';
import { PlaceholderArt } from './PlaceholderArt';
import { focusRing } from './focus';

/**
 * Catalogue art (Cover Art Archive or Deezer) at the row's size, over the placeholder square so a
 * row never shows an empty box or a broken-image glyph while the picture loads or when it has none.
 */
export function RemoteArt({ src, index }: { src: string | undefined; index: number }) {
  const [broken, setBroken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const show = !!src && broken !== src;
  return (
    <span className="relative size-9 shrink-0">
      <PlaceholderArt index={index} size="xs" className="rounded-sm" />
      {show ? (
        <img
          src={src}
          alt={decorativeAlt}
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 size-full rounded-sm object-cover ${loaded === src ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setLoaded(src)}
          onError={() => setBroken(src)}
        />
      ) : null}
    </span>
  );
}

/** The title sits beside the art, so the image itself is decorative. */
const decorativeAlt = '';

/** One 30-second preview at a time across the app. */
let current: { audio: HTMLAudioElement; stop: () => void } | null = null;

export function stopPreview(): void {
  current?.stop();
}

/** Deezer's 30-second preview behind a small play glyph; a second tap, or another preview, stops it. */
export function PreviewButton({ src, title }: { src: string; title: string }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => (playing ? stopPreview() : undefined), [playing]);
  function toggle(event: MouseEvent): void {
    // The row itself adds; the preview only plays.
    event.stopPropagation();
    if (playing) {
      stopPreview();
      return;
    }
    stopPreview();
    const audio = new Audio(src);
    const stop = (): void => {
      audio.pause();
      setPlaying(false);
      if (current?.audio === audio) current = null;
    };
    current = { audio, stop };
    audio.onended = stop;
    void audio.play().then(
      () => setPlaying(true),
      () => stop(),
    );
  }
  return (
    <button
      type="button"
      aria-label={playing ? t('catalogue.stopPreview') : t('catalogue.preview', { title })}
      aria-pressed={playing}
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggle}
      className={`grid size-8 shrink-0 place-items-center rounded-pill text-muted-foreground hover:text-foreground ${focusRing}`}
    >
      <span
        className={`grid size-6 place-items-center rounded-pill border border-border ${playing ? 'bg-muted text-foreground' : ''}`}
      >
        <Icon name={playing ? 'pause' : 'play'} className="size-3" />
      </span>
    </button>
  );
}

/** "Fireman" with "Chopped & Screwed" moved into the subtitle, where a narrow row still shows it. */
export function rowHeading(row: CatalogueRow): { title: string; version?: string } {
  return row.kind === 'song' ? splitTitleVersion(row.item.title) : { title: row.item.title };
}

/** The second line: version, artist, album or year, length, then what the row's add did. */
export function rowSubtitle(row: CatalogueRow, status: RowStatus, t: TFunction): string {
  const said = rowStatusText(status, t);
  const parts =
    row.kind === 'song'
      ? [
          rowHeading(row).version,
          row.item.artist,
          row.item.album,
          row.item.duration !== undefined ? formatDuration(row.item.duration) : undefined,
        ]
      : [
          t('search.albums'),
          row.item.artist,
          row.item.year !== undefined ? String(row.item.year) : undefined,
        ];
  return [...parts, said].filter((p): p is string => !!p).join(' · ');
}

/** The glyph at the end of the row: plus before a tap, a check once it is here or Ready. */
export function RowGlyph({ status }: { status: RowStatus }) {
  const name =
    status.kind === 'ready' || status.kind === 'already'
      ? 'check'
      : status.kind === 'none' || status.kind === 'failed'
        ? 'plus'
        : null;
  if (!name) {
    return (
      <span
        aria-hidden
        className="size-4 shrink-0 animate-pulse rounded-pill border-2 border-info"
      />
    );
  }
  return (
    <Icon
      name={name}
      className={`size-4 shrink-0 ${status.kind === 'ready' || status.kind === 'already' ? 'text-success' : 'text-muted-foreground'}`}
    />
  );
}
