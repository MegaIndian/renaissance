import { describe, expect, it } from 'vitest';

import { migrate, migrations, openDatabase } from '../src/db/index.js';
import { memoryStores, mom, sahil } from './helpers.js';

describe('database', () => {
  it('runs every migration once and is idempotent', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db)).toBe(0);
    const row = db.prepare('SELECT version FROM schema_version').get() as unknown as {
      version: number;
    };
    expect(row.version).toBe(migrations.length);
    db.close();
  });

  it('rolls a failing migration back', () => {
    const db = openDatabase(':memory:');
    (migrations as string[]).push('CREATE TABLE will_fail (a); THIS IS NOT SQL;');
    try {
      expect(() => migrate(db)).toThrow();
      expect(() => db.prepare('SELECT * FROM will_fail').all()).toThrow();
      expect(
        (db.prepare('SELECT version FROM schema_version').get() as unknown as { version: number })
          .version,
      ).toBe(migrations.length - 1);
    } finally {
      (migrations as string[]).pop();
      db.close();
    }
  });
});

describe('profiles', () => {
  it('upserts on every sighting and keeps preferences', () => {
    const s = memoryStores();
    expect(s.profiles.get(sahil.id)).toEqual(sahil);
    const seen = s.profiles.seen(sahil.id, 'Sahil P', 'member');
    expect(seen).toEqual({ ...sahil, name: 'Sahil P', role: 'member' });
    expect(s.profiles.list().map((p) => p.name)).toEqual(['Mom', 'Sahil P']);
    expect(s.profiles.get('nobody')).toBeUndefined();
  });
});

describe('collection', () => {
  it("adds once per profile and item, lists newest first, removes only the owner's row", () => {
    const s = memoryStores();
    const a = s.collection.add({
      profile: sahil.id,
      item: 'jf1',
      kind: 'track',
      title: 'Fireman',
      artist: 'Lil Wayne',
      addedBy: sahil.id,
      source: 'add',
    });
    const again = s.collection.add({
      profile: sahil.id,
      item: 'jf1',
      kind: 'track',
      title: 'Fireman',
      artist: 'Lil Wayne',
      album: 'Tha Carter II',
      addedBy: sahil.id,
      source: 'request',
    });
    expect(again.id).toBe(a.id);
    const b = s.collection.add({
      profile: sahil.id,
      item: 'jf2',
      kind: 'album',
      title: 'X',
      artist: 'Y',
      album: 'X',
      addedBy: mom.id,
      source: 'import',
    });
    expect(s.collection.list(sahil.id).map((i) => i.id)).toEqual([b.id, a.id]);
    expect(s.collection.list(mom.id)).toEqual([]);
    expect(s.collection.listHouse()).toHaveLength(2);
    expect(s.collection.get(b.id)?.album).toBe('X');
    expect(s.collection.remove(a.id, mom.id)).toBeUndefined();
    expect(s.collection.remove(a.id, sahil.id)?.id).toBe(a.id);
    expect(s.collection.list(sahil.id)).toHaveLength(1);
  });
});

describe('requests', () => {
  it('creates, updates with steps and ids, lists by profile newest first', () => {
    const s = memoryStores();
    const r1 = s.requests.create(
      { kind: 'track', title: 'Fireman', artist: 'Lil Wayne' },
      sahil.id,
    );
    const r2 = s.requests.create(
      {
        kind: 'album',
        title: 'Tha Carter II',
        artist: 'Lil Wayne',
        releaseGroupId: '11111111-1111-4111-8111-111111111111',
      },
      mom.id,
    );
    expect(r1.status).toBe('requested');
    expect(r1.requestedByName).toBe('Sahil');
    expect(r1.steps).toHaveLength(1);
    const updated = s.requests.update(r1.id, {
      status: 'finding',
      detail: 'matched',
      ids: {
        recordingId: '22222222-2222-4222-8222-222222222222',
        duration: 183,
        album: 'Tha Carter II',
      },
    })!;
    expect(updated.status).toBe('finding');
    expect(updated.recordingId).toBe('22222222-2222-4222-8222-222222222222');
    expect(updated.duration).toBe(183);
    expect(updated.album).toBe('Tha Carter II');
    expect(updated.steps.map((x) => x.status)).toEqual(['requested', 'finding']);
    const failed = s.requests.update(r1.id, {
      status: 'failed',
      reason: 'no_results',
      detail: 'nothing',
      progress: { done: 1, total: 2 },
    })!;
    expect(failed.reason).toBe('no_results');
    expect(failed.progress).toEqual({ done: 1, total: 2 });
    expect(failed.recordingId).toBe('22222222-2222-4222-8222-222222222222');
    expect(s.requests.listMine(sahil.id).map((r) => r.id)).toEqual([r1.id]);
    expect(s.requests.listHouse().map((r) => r.id)).toEqual([r2.id, r1.id]);
    expect(s.requests.listByStatus('requested').map((r) => r.id)).toEqual([r2.id]);
    expect(s.requests.update('nope', { status: 'failed' })).toBeUndefined();
    expect(s.requests.remove(r2.id)).toBe(true);
    expect(s.requests.remove(r2.id)).toBe(false);
  });
});

describe('rules, usage, cache', () => {
  it('rules belong to a profile', () => {
    const s = memoryStores();
    const r = s.rules.add(sahil.id, 'no live versions');
    expect(s.rules.list(sahil.id)).toEqual([r]);
    expect(s.rules.remove(r.id, mom.id)).toBeUndefined();
    expect(s.rules.remove(r.id, sahil.id)).toEqual(r);
  });

  it('usage sums per day and per month for one profile and the house', () => {
    const s = memoryStores();
    const now = new Date('2026-11-17T12:00:00Z');
    const sample = {
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 500,
      cacheWriteTokens: 0,
      costUsd: 0.01,
    };
    s.usage.record(sahil.id, sample, now);
    s.usage.record(sahil.id, sample, now);
    s.usage.record(mom.id, sample, new Date('2026-11-18T12:00:00Z'));
    s.usage.record(mom.id, sample, new Date('2026-10-01T12:00:00Z'));
    expect(s.usage.monthSpent(now)).toBeCloseTo(0.03);
    expect(s.usage.days(sahil.id, now)).toEqual([
      { day: '2026-11-17', calls: 2, inputTokens: 2000, outputTokens: 200, costUsd: 0.02 },
    ]);
    expect(s.usage.days('house', now).map((d) => d.day)).toEqual(['2026-11-17', '2026-11-18']);
  });

  it('cache honours the ttl and sweeps', () => {
    const s = memoryStores();
    s.cache.set('k', { a: 1 }, 1000, 0);
    expect(s.cache.get('k', 500)).toEqual({ a: 1 });
    expect(s.cache.get('k', 1000)).toBeUndefined();
    s.cache.set('k2', 2, 1000, 0);
    s.cache.sweep(5000);
    expect(s.cache.get('k2', 0)).toBeUndefined();
    s.cache.set('k3', 3, 1000, 0);
    s.cache.delete('k3');
    expect(s.cache.get('k3', 0)).toBeUndefined();
  });
});
