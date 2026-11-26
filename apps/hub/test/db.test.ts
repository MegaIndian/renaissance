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
      progress: { unit: 'percent', done: 1, total: 2 },
    })!;
    expect(failed.reason).toBe('no_results');
    expect(failed.progress).toEqual({ unit: 'percent', done: 1, total: 2 });
    expect(failed.recordingId).toBe('22222222-2222-4222-8222-222222222222');
    expect(s.requests.listMine(sahil.id).map((r) => r.id)).toEqual([r1.id]);
    expect(s.requests.listMine(mom.id).map((r) => r.id)).toEqual([r2.id]);
    expect(s.requests.listByStatus('requested').map((r) => r.id)).toEqual([r2.id]);
    expect(s.requests.update('nope', { status: 'failed' })).toBeUndefined();
    expect(s.requests.remove(r2.id)).toBe(true);
    expect(s.requests.remove(r2.id)).toBe(false);
  });
});

describe('cache', () => {
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

describe('requests: steps and progress', () => {
  it('caps the step log at MAX_STEPS keeping the first and the latest, and progress adds no step', async () => {
    const { MAX_STEPS } = await import('../src/db/requests.js');
    const s = memoryStores();
    const r = s.requests.create({ kind: 'album', title: 'Red', artist: 'Taylor Swift' }, sahil.id);
    for (let i = 0; i < 120; i++) {
      s.requests.update(r.id, { status: 'finding', detail: `poll ${i}` });
    }
    const row = s.requests.get(r.id)!;
    expect(row.steps).toHaveLength(MAX_STEPS);
    expect(row.steps[0]).toMatchObject({ status: 'requested' });
    expect(row.steps[row.steps.length - 1]).toMatchObject({ detail: 'poll 119' });
    expect(row.steps[1]).toMatchObject({ detail: `poll ${120 - (MAX_STEPS - 1)}` });
    const before = JSON.stringify(row.steps).length;
    for (let i = 0; i < 1000; i++) {
      s.requests.progress(r.id, { unit: 'songs', done: i, total: 1000 });
    }
    const polled = s.requests.get(r.id)!;
    expect(polled.steps).toHaveLength(MAX_STEPS);
    expect(JSON.stringify(polled.steps).length).toBe(before);
    expect(polled.progress).toEqual({ unit: 'songs', done: 999, total: 1000 });
    expect(polled.status).toBe('finding');
    s.requests.progress(r.id, { unit: 'percent', done: 40, total: 100, etaSeconds: 90 });
    expect(s.requests.get(r.id)?.progress).toEqual({
      unit: 'percent',
      done: 40,
      total: 100,
      etaSeconds: 90,
    });
    expect(s.requests.progress('missing', { unit: 'songs', done: 0, total: 0 })).toBeUndefined();
  });

  it('migration 3 turns old failed/cancelled rows into the cancelled status', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec(migrations[0]!);
    db.exec(migrations[1]!);
    db.exec(
      'CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (2)',
    );
    db.exec(`INSERT INTO profiles VALUES ('p', 'P', 'member', 'simple', 'en', 'now', 'now')`);
    db.exec(
      `INSERT INTO requests (id, seq, kind, title, artist, requested_by, status, reason, steps, created_at, updated_at)
       VALUES ('r1', 1, 'track', 'A', 'B', 'p', 'failed', 'cancelled', '[]', 'now', 'now'),
              ('r2', 2, 'track', 'A', 'B', 'p', 'failed', 'no_results', '[]', 'now', 'now')`,
    );
    expect(migrate(db)).toBe(migrations.length - 2);
    const rows = db
      .prepare('SELECT id, status, reason FROM requests ORDER BY seq')
      .all() as unknown as {
      id: string;
      status: string;
      reason: string | null;
    }[];
    expect(rows).toEqual([
      { id: 'r1', status: 'cancelled', reason: null },
      { id: 'r2', status: 'failed', reason: 'no_results' },
    ]);
    db.close();
  });
});
