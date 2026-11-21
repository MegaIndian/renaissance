import type { DatabaseSync } from 'node:sqlite';

import type { Profile } from '@renaissance/core';

interface Row {
  id: string;
  name: string;
  role: 'admin' | 'member';
  mode: 'simple' | 'advanced';
  language: 'en' | 'gu';
}

const toProfile = (r: Row): Profile => ({
  id: r.id,
  name: r.name,
  role: r.role,
  mode: r.mode,
  language: r.language,
});

export function profileStore(db: DatabaseSync) {
  const upsert = db.prepare(`
    INSERT INTO profiles (id, name, role, mode, language, created_at, last_seen_at)
    VALUES (?, ?, ?, 'simple', 'en', ?, ?)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, role = excluded.role, last_seen_at = excluded.last_seen_at
  `);
  const byId = db.prepare('SELECT id, name, role, mode, language FROM profiles WHERE id = ?');
  const all = db.prepare('SELECT id, name, role, mode, language FROM profiles ORDER BY name');
  const setPrefs = db.prepare('UPDATE profiles SET mode = ?, language = ? WHERE id = ?');
  return {
    /** Called on every authenticated request: name and role follow Jellyfin, preferences stay. */
    seen(id: string, name: string, role: Profile['role'], now = new Date()): Profile {
      const iso = now.toISOString();
      upsert.run(id, name, role, iso, iso);
      return toProfile(byId.get(id) as unknown as Row);
    },
    get(id: string): Profile | undefined {
      const row = byId.get(id) as unknown as Row | undefined;
      return row ? toProfile(row) : undefined;
    },
    list(): Profile[] {
      return (all.all() as unknown as Row[]).map(toProfile);
    },
    setPreferences(id: string, mode: Profile['mode'], language: Profile['language']): Profile {
      setPrefs.run(mode, language, id);
      return toProfile(byId.get(id) as unknown as Row);
    },
  };
}
export type ProfileStore = ReturnType<typeof profileStore>;
