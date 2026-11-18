import { formatDuration } from '@renaissance/core';
import type { RepeatMode } from '@renaissance/core';
import { useTranslation } from 'react-i18next';

import { getPlayer } from '../lib/player';
import { useMode, useSettings } from '../lib/mode';
import { usePlayer } from '../lib/usePlayer';
import { Icon } from './Icon';
import { focusRing } from './focus';

const iconButton = `grid min-h-6 min-w-6 shrink-0 place-items-center rounded-pill ${focusRing}`;

/** Previous, play or pause, next, with shuffle and repeat around them when asked (F23, F24). */
export function TransportControls({
  size = 'md',
  withModes = false,
}: {
  size?: 'sm' | 'md' | 'lg';
  withModes?: boolean;
}) {
  const { t } = useTranslation();
  const { status, queue } = usePlayer();
  const settings = useSettings();
  const player = getPlayer();
  const hasTrack = queue.index >= 0;
  const playing = status === 'playing' || status === 'loading';
  const play = { sm: 'size-8', md: 'size-10', lg: 'size-14' }[size];
  const glyph = { sm: 'size-4', md: 'size-5', lg: 'size-7' }[size];
  const skip = { sm: 'size-8', md: 'size-9', lg: 'size-11' }[size];
  const repeatLabel: Record<RepeatMode, string> = {
    off: t('player.repeatOff'),
    all: t('player.repeatAll'),
    one: t('player.repeatOne'),
  };
  return (
    <div className="flex items-center justify-center gap-2 sm:gap-3">
      {withModes ? (
        <button
          type="button"
          aria-pressed={queue.shuffle}
          aria-label={queue.shuffle ? t('player.shuffleOn') : t('player.shuffleOff')}
          onClick={() => player.setShuffle(!queue.shuffle, settings.albumAwareShuffle)}
          className={`${iconButton} ${skip} ${queue.shuffle ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Icon name="shuffle" className="size-4" />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={t('player.previous')}
        disabled={!hasTrack}
        onClick={() => player.previous()}
        className={`${iconButton} ${skip} text-foreground disabled:text-muted-foreground`}
      >
        <Icon name="previous" className={glyph} />
      </button>
      <button
        type="button"
        aria-label={playing ? t('player.pause') : t('player.play')}
        disabled={!hasTrack}
        onClick={() => player.toggle()}
        className={`${iconButton} ${play} ${
          hasTrack
            ? 'bg-primary text-primary-foreground hover:opacity-90'
            : 'bg-muted text-muted-foreground disabled:cursor-not-allowed'
        }`}
      >
        <Icon name={playing ? 'pause' : 'play'} className={glyph} />
      </button>
      <button
        type="button"
        aria-label={t('player.next')}
        disabled={!hasTrack}
        onClick={() => player.next()}
        className={`${iconButton} ${skip} text-foreground disabled:text-muted-foreground`}
      >
        <Icon name="next" className={glyph} />
      </button>
      {withModes ? (
        <button
          type="button"
          aria-label={repeatLabel[queue.repeat]}
          onClick={() => player.cycleRepeat()}
          className={`${iconButton} ${skip} ${queue.repeat !== 'off' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Icon name={queue.repeat === 'one' ? 'repeatOne' : 'repeat'} className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/** The scrubber (F24): a range input, so arrow keys, Home and End seek as well as the pointer. */
export function Scrubber({
  withTimes = true,
  className = '',
}: {
  withTimes?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { position, duration, queue } = usePlayer();
  const player = getPlayer();
  const max = Math.max(1, Math.round(duration || queue.items[queue.index]?.duration || 0));
  const value = Math.min(max, Math.round(position));
  return (
    <div className={`flex w-full items-center gap-2 ${className}`}>
      {withTimes ? (
        <span className="w-10 shrink-0 text-right font-mono text-caption text-muted-foreground">
          {formatDuration(value)}
        </span>
      ) : null}
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={queue.index < 0}
        aria-label={t('player.seek')}
        aria-valuetext={`${formatDuration(value)} / ${formatDuration(max)}`}
        onChange={(event) => player.seek(Number(event.target.value))}
        className={`h-6 min-w-0 flex-1 accent-primary ${focusRing}`}
      />
      {withTimes ? (
        <span className="w-10 shrink-0 font-mono text-caption text-muted-foreground">
          -{formatDuration(Math.max(0, max - value))}
        </span>
      ) : null}
    </div>
  );
}

export function VolumeControl() {
  const { t } = useTranslation();
  const { volume } = usePlayer();
  const player = getPlayer();
  return (
    <div className="hidden items-center gap-2 lg:flex">
      <Icon name="volume" className="size-4 text-muted-foreground" />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(volume * 100)}
        aria-label={t('player.volume')}
        onChange={(event) => player.setVolume(Number(event.target.value) / 100)}
        className={`h-6 w-24 accent-primary ${focusRing}`}
      />
    </div>
  );
}

/** Direct or transcoded, codec and bitrate: advanced mode only. */
export function PlaybackDetails() {
  const { t } = useTranslation();
  const mode = useMode();
  const { method, queue } = usePlayer();
  const track = queue.items[queue.index];
  if (mode !== 'advanced' || !track || !method) return null;
  const parts = [
    method === 'direct' ? t('player.direct') : t('player.transcode'),
    track.codec?.toUpperCase(),
    track.bitrate ? `${Math.round(track.bitrate / 1000)} kbps` : undefined,
    track.sampleRate ? `${(track.sampleRate / 1000).toFixed(1)} kHz` : undefined,
  ].filter(Boolean);
  return <p className="text-caption text-muted-foreground">{parts.join(' · ')}</p>;
}
