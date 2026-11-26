import { playedBefore, upNext } from '@renaissance/core';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { titleOf } from '../lib/names';
import { getPlayer } from '../lib/player';
import { toast } from '../lib/toast';
import { usePlayer } from '../lib/usePlayer';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { useTrackRowHeight } from './TrackList';
import { TrackRow } from './TrackRow';
import { VirtualList } from './VirtualList';

/**
 * The queue (F22): now playing, up next with drag to reorder (and Move up / Move down in each row's
 * menu for the keyboard), remove, clear with undo, and what played earlier. Up next renders only
 * the rows in view, as the songs list does: a shuffle of a 20,000-song library is a few dozen rows
 * in the DOM, not twenty thousand (func AI).
 */
export function QueueList() {
  const { t } = useTranslation();
  const snapshot = usePlayer();
  const player = getPlayer();
  const rowHeight = useTrackRowHeight();
  const { queue, status } = snapshot;
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const current = queue.items[queue.index];
  const next = upNext(queue);
  const history = playedBefore(queue).slice(-20).reverse();

  if (!current) {
    return <EmptyState title={t('queue.empty')} description={t('queue.emptyBody')} />;
  }

  /** Every reorder, by drag or from the menu, says what it did and can be undone (rule 10). */
  const moveWithUndo = (from: number, to: number): void => {
    if (from === to) return;
    player.move(from, to);
    toast(
      t('playlist.reorderedTo', {
        title: queue.items[from] ? titleOf(queue.items[from], t) : '',
        position: to - queue.index,
      }),
      { undo: () => player.move(to, from) },
    );
  };

  const drop = (toQueueIndex: number): void => {
    if (dragging === null) return;
    const from = dragging;
    setDragging(null);
    setOver(null);
    moveWithUndo(from, toQueueIndex);
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
          <VirtualList
            items={next}
            rowHeight={rowHeight}
            label={t('queue.upNext')}
            keyOf={(_track, i) => String(queue.keys[queue.index + 1 + i])}
            renderItem={(track, i) => {
              const queueIndex = queue.index + 1 + i;
              return (
                <DraggableRow
                  onDragStart={() => setDragging(queueIndex)}
                  onDragOver={() => setOver(queueIndex)}
                  onDragLeave={() => setOver((o) => (o === queueIndex ? null : o))}
                  onDrop={() => drop(queueIndex)}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  target={over === queueIndex && dragging !== queueIndex}
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
                        onSelect: () => moveWithUndo(queueIndex, queueIndex - 1),
                      },
                      {
                        key: 'down',
                        label: t('queue.moveDown'),
                        icon: 'arrowDown',
                        disabled: i === next.length - 1,
                        onSelect: () => moveWithUndo(queueIndex, queueIndex + 1),
                      },
                      {
                        key: 'remove',
                        label: t('queue.remove'),
                        icon: 'close',
                        tone: 'danger',
                        onSelect: () => {
                          const before = queue;
                          player.removeAt(queueIndex);
                          toast(t('queue.removed', { title: titleOf(track, t) }), {
                            undo: () => player.restore(before, player.snapshot.position),
                          });
                        },
                      },
                    ]}
                  />
                </DraggableRow>
              );
            }}
          />
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

/**
 * A row that can be dragged onto another; the drop target shows a `primary` line along its top
 * edge, drawn inside the row so a virtual list's fixed row height holds. Shared by the queue and
 * the playlist page (func AI, AJ); Move up and Move down in the row's menu serve the keyboard.
 */
export function DraggableRow({
  children,
  target,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  children: ReactNode;
  target: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      className="relative h-full"
      onDragStart={(e) => {
        onDragStart();
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
    >
      {target ? <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-primary" /> : null}
      {children}
    </div>
  );
}
