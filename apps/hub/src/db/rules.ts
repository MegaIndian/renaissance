import type { DatabaseSync } from 'node:sqlite';

import type { Rule } from '@renaissance/core';

interface Row {
  id: number;
  profile: string;
  text: string;
  created_at: string;
}

const toRule = (r: Row): Rule => ({
  id: r.id,
  profile: r.profile,
  text: r.text,
  createdAt: r.created_at,
});

export function ruleStore(db: DatabaseSync) {
  const insert = db.prepare(
    'INSERT INTO rules (profile, text, created_at) VALUES (?, ?, ?) RETURNING *',
  );
  const byProfile = db.prepare('SELECT * FROM rules WHERE profile = ? ORDER BY id');
  const remove = db.prepare('DELETE FROM rules WHERE id = ? AND profile = ? RETURNING *');
  return {
    add(profile: string, text: string, now = new Date()): Rule {
      return toRule(insert.get(profile, text, now.toISOString()) as unknown as Row);
    },
    list(profile: string): Rule[] {
      return (byProfile.all(profile) as unknown as Row[]).map(toRule);
    },
    remove(id: number, profile: string): Rule | undefined {
      const row = remove.get(id, profile) as unknown as Row | undefined;
      return row ? toRule(row) : undefined;
    },
  };
}
export type RuleStore = ReturnType<typeof ruleStore>;
