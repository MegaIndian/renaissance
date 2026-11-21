import type { DatabaseSync } from 'node:sqlite';

import type { CollectionItem, CollectionSource, RequestKind } from '@renaissance/core';

interface Row {
  id: number;
  profile: string;
  item: string;
  kind: RequestKind;
  title: string;
  artist: string;
  album: string | null;
  added_by: string;
  added_at: string;
  source: CollectionSource;
}

const toItem = (r: Row): CollectionItem => ({
  id: r.id,
  profile: r.profile,
  item: r.item,
  kind: r.kind,
  title: r.title,
  artist: r.artist,
  ...(r.album === null ? {} : { album: r.album }),
  addedBy: r.added_by,
  addedAt: r.added_at,
  source: r.source,
});

export interface NewCollectionItem {
  profile: string;
  item: string;
  kind: RequestKind;
  title: string;
  artist: string;
  album?: string;
  addedBy: string;
  source: CollectionSource;
}

export function collectionStore(db: DatabaseSync) {
  const insert = db.prepare(`
    INSERT INTO collection (profile, item, kind, title, artist, album, added_by, added_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (profile, item) DO UPDATE SET added_at = collection.added_at
    RETURNING *
  `);
  const byProfile = db.prepare('SELECT * FROM collection WHERE profile = ? ORDER BY id DESC');
  const byId = db.prepare('SELECT * FROM collection WHERE id = ?');
  const remove = db.prepare('DELETE FROM collection WHERE id = ? AND profile = ? RETURNING *');
  const house = db.prepare('SELECT * FROM collection ORDER BY id DESC');
  return {
    /** Idempotent: adding what is already in the collection returns the existing row. */
    add(input: NewCollectionItem, now = new Date()): CollectionItem {
      const row = insert.get(
        input.profile,
        input.item,
        input.kind,
        input.title,
        input.artist,
        input.album ?? null,
        input.addedBy,
        now.toISOString(),
        input.source,
      ) as unknown as Row;
      return toItem(row);
    },
    list(profile: string): CollectionItem[] {
      return (byProfile.all(profile) as unknown as Row[]).map(toItem);
    },
    listHouse(): CollectionItem[] {
      return (house.all() as unknown as Row[]).map(toItem);
    },
    get(id: number): CollectionItem | undefined {
      const row = byId.get(id) as unknown as Row | undefined;
      return row ? toItem(row) : undefined;
    },
    remove(id: number, profile: string): CollectionItem | undefined {
      const row = remove.get(id, profile) as unknown as Row | undefined;
      return row ? toItem(row) : undefined;
    },
  };
}
export type CollectionStore = ReturnType<typeof collectionStore>;
