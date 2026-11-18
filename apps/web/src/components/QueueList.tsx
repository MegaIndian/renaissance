import { playedBefore, upNext } from '@renaissance/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getPlayer } from '../lib/player';
import { toast } from '../lib/toast';
import { usePlayer } from '../lib/usePlayer';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { TrackRow } from './TrackRow';

/**
 * The queue (F22): now playing, up next with drag to reorder (and Move up / Move down in each row's
 * menu for the keyboard), remove, clear with undo, and what played earlier.
 */
export function QueueList() {
  const { t } = useTranslation();
  const snapshot = usePlayer();
  const player = getPlayer();
  const { queue, status } = snapshot;
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const current = queue.items[queue.index];
  const next = upNext(queue);
  const history = playedBefore(queue).slice(-20).reverse();

  if (!current) {
    return <EmptyState title={t('queue.empty')} description={t('queue.emptyBody')} />;
  }

  const drop = (toQueueIndex: number): void => {
    if (dragging === null) return;
    const from = dragging;
    setDragging(null);
    setOver(null);
    if (from === toQueueIndex) return;
    player.move(from, toQueueIndex);
    toast(t('playlist.reordered', { title: queue.items[from]?.title ?? '' }), {
      undo: () => player.move(toQueueIndex, from),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2" aria-label={t('queue.nowPlaying')}>
        <h2 className="text-label font-medium text-muted-foreground">{t('queue.nowPlaying')}</h2>
        <TrackRow
          track={current}
          index={queue.index}
          playing
          paused={status !== 'playing' && status !== 'loading'}
          onPlay={() => player.toggle()}
        />
      </section>
      <section className="flex flex-col gap-2" aria-label={t('queue.upNext')}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-label font-medium text-muted-foreground">
            {t('queue.upNext')} · {t('queue.count', { count: next.length })}
          </h2>
          <Button
            tone="ghost"
            className="text-caption"
            onClick={() => {
              const before = queue;
              const position = snapshot.position;
              player.clear();
              toast(t('queue.cleared'), { undo: () => player.restore(before, position) });
            }}
          >
            {t('queue.clear')}
          </Button>
        </div>
        {next.length === 0 ? (
          <EmptyState title={t('queue.empty')} quiet />
        ) : (
          <ol className="flex flex-col" aria-label={t('queue.upNext')}>
            {next.map((track, i) => {
              const queueIndex = queue.index + 1 + i;
              return (
                <li
                  key={queue.keys[queueIndex]}
                  draggable
                  onDragStart={(e) => {
                    setDragging(queueIndex);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(queueIndex);
                  }}
                  onDragLeave={() => setOver((o) => (o === queueIndex ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(queueIndex);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  className={
                    over === queueIndex && dragging !== queueIndex
                      ? 'border-t-2 border-primary'
                      : ''
                  }
                >
                  <TrackRow
                    track={track}
                    index={queueIndex}
                    onPlay={() => player.jumpTo(queueIndex)}
                    dragHandleProps={{ 'aria-label': t('queue.dragHandle'), role: 'img' }}
                    menuExtra={[
                      {
                        key: 'up',
                        label: t('queue.moveUp'),
                        icon: 'arrowUp',
                        disabled: i === 0,
                        onSelect: () => player.move(queueIndex, queueIndex - 1),
                      },
                      {
                        key: 'down',
                        label: t('queue.moveDown'),
                        icon: 'arrowDown',
                        disabled: i === next.length - 1,
                        onSelect: () => player.move(queueIndex, queueIndex + 1),
                      },
                      {
                        key: 'remove',
                        label: t('queue.remove'),
                        icon: 'close',
                        tone: 'danger',
                        onSelect: () => {
                          const before = queue;
                          player.removeAt(queueIndex);
                          toast(t('queue.removed', { title: track.title }), {
                            undo: () => player.restore(before, player.snapshot.position),
                          });
                        },
                      },
                    ]}
                  />
                </li>
              );
            })}
          </ol>
        )}
      </section>
      {history.length ? (
        <section className="flex flex-col gap-2" aria-label={t('queue.history')}>
          <h2 className="text-label font-medium text-muted-foreground">{t('queue.history')}</h2>
          <ol className="flex flex-col">
            {history.map((track, i) => (
              <li key={`${track.id}-${i}`}>
                <TrackRow
                  track={track}
                  index={i}
                  onPlay={() => {
                    const at = queue.items.indexOf(track);
                    if (at >= 0) player.jumpTo(at);
                  }}
                />
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
