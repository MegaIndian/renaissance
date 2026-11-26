/**
 * The persisted queue (F22), one format for every app: the id of the song behind each key, with
 * the queue's keys and bookkeeping, never the songs themselves. A 20,000-song shuffle of the whole
 * library is under a megabyte this way and about 16 MB as songs (func AA). The songs come back from
 * the library snapshot on restore; one the library no longer has is dropped. Each app keeps the two
 * strings (the record and the position) in its own key-value store.
 */
import type { Track } from './models';
import { parseQueue } from './queue';
import type { QueueState, RepeatMode } from './queue';

export interface SavedQueue {
  userId: string;
  version: 2;
  /** The song behind each key, aligned with `keys`. */
  ids: string[];
  keys: number[];
  orderKeys: number[];
  index: number;
  history: number[];
  nextKey: number;
  shuffle: boolean;
  albumAware: boolean;
  repeat: RepeatMode;
  position: number;
}

/** The shape before version 2, whole songs; still read once so an upgrade keeps the queue. */
interface LegacySavedQueue {
  userId: string;
  queue: unknown;
  position: number;
}

export function toSavedQueue(userId: string, queue: QueueState, position: number): SavedQueue {
  return {
    userId,
    version: 2,
    ids: queue.items.map((t) => t.id),
    keys: queue.keys,
    orderKeys: queue.orderKeys,
    index: queue.index,
    history: queue.history,
    nextKey: queue.nextKey,
    shuffle: queue.shuffle,
    albumAware: queue.albumAware,
    repeat: queue.repeat,
    position,
  };
}

const isInts = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((v) => Number.isInteger(v));

/**
 * Read a saved queue, with the songs looked up in the library by id. `record` is the stored JSON,
 * `ownPosition` the position kept under its own key (written more often; it wins when it parses). A
 * song the library no longer holds is left out; when the current song is one of them, the song
 * after it is current and the position starts from zero. Nothing left, or garbage, is `null`.
 */
export function readSavedQueue(
  record: string | null,
  ownPosition: string | null,
  lookup: (id: string) => Track | undefined,
): { queue: QueueState; position: number } | null {
  if (!record) return null;
  try {
    const parsed = JSON.parse(record) as Partial<SavedQueue & LegacySavedQueue>;
    const fromRecord =
      typeof parsed.position === 'number' && parsed.position >= 0 ? parsed.position : 0;
    if (parsed.version !== 2) {
      const queue = parseQueue(parsed.queue);
      return queue.items.length ? { queue, position: fromRecord } : null;
    }
    const own = ownPosition === null || ownPosition === '' ? Number.NaN : Number(ownPosition);
    const position = Number.isFinite(own) && own >= 0 ? own : fromRecord;
    const rehydrated = rehydrate(parsed, lookup);
    if (!rehydrated || !rehydrated.queue.items.length) return null;
    return { queue: rehydrated.queue, position: rehydrated.currentKept ? position : 0 };
  } catch {
    return null;
  }
}

function rehydrate(
  saved: Partial<SavedQueue>,
  lookup: (id: string) => Track | undefined,
): { queue: QueueState; currentKept: boolean } | null {
  const { ids, keys, orderKeys, history, index } = saved;
  if (
    !Array.isArray(ids) ||
    !isInts(keys) ||
    !isInts(orderKeys) ||
    !isInts(history) ||
    ids.length !== keys.length ||
    orderKeys.length !== keys.length ||
    !Number.isInteger(index) ||
    (index as number) < -1 ||
    (index as number) >= ids.length
  ) {
    return null;
  }
  const at = index as number;
  const byKey = new Map<number, Track>();
  const items: Track[] = [];
  const keptKeys: number[] = [];
  let keptBefore = 0;
  let currentKept = false;
  ids.forEach((id, i) => {
    const key = keys[i] as number;
    const track = typeof id === 'string' ? lookup(id) : undefined;
    if (!track) return;
    byKey.set(key, track);
    items.push(track);
    keptKeys.push(key);
    if (i < at) keptBefore += 1;
    if (i === at) currentKept = true;
  });
  const keptOrderKeys = orderKeys.filter((key) => byKey.has(key));
  const queue: QueueState = {
    items,
    index: at < 0 ? -1 : currentKept ? keptBefore : Math.min(keptBefore, items.length - 1),
    order: keptOrderKeys.map((key) => byKey.get(key) as Track),
    keys: keptKeys,
    orderKeys: keptOrderKeys,
    history: history.filter((key) => byKey.has(key)),
    nextKey:
      typeof saved.nextKey === 'number' ? saved.nextKey : Math.max(-1, ...keys, ...orderKeys) + 1,
    shuffle: saved.shuffle === true,
    albumAware: saved.albumAware === true,
    repeat: saved.repeat === 'all' || saved.repeat === 'one' ? saved.repeat : 'off',
  };
  return { queue, currentKept };
}
