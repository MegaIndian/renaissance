import { describe as suite, expect, it } from 'vitest';

import { ConfigError, DEV_CORS_ORIGINS, describe, loadConfig } from '../src/config.js';

suite('loadConfig', () => {
  it('uses defaults with an empty environment, including the dev CORS origin', () => {
    const c = loadConfig({});
    expect(c.port).toBe(8787);
    expect(c.host).toBe('0.0.0.0');
    expect(c.environment).toBe('development');
    expect(c.corsOrigins).toEqual([...DEV_CORS_ORIGINS]);
    expect(c.anthropic.intentModel).toBe('claude-opus-5-5');
    expect(c.anthropic.enrichmentModel).toBe('claude-haiku-5-5');
    expect(c.databasePath).toBe('./data/hub.sqlite');
    expect(c.budgetUsdPerMonth).toBe(10);
    expect(c.admins).toEqual([]);
    expect(c.dryRun).toBe(false);
    expect(c.trustProxy).toBe(false);
    expect(c.lidarrDownloadsDir).toBe('/downloads/complete');
    expect(c.navidrome).toEqual({ url: undefined, user: undefined, password: undefined });
  });

  it('allows no browser origin in production unless configured', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).corsOrigins).toEqual([]);
    expect(
      loadConfig({ NODE_ENV: 'production', RENAISSANCE_HUB_CORS_ORIGINS: 'https://m.test' })
        .corsOrigins,
    ).toEqual(['https://m.test']);
  });

  it('reads values, lists and flags', () => {
    const c = loadConfig({
      RENAISSANCE_HUB_PORT: '9000',
      RENAISSANCE_HUB_CORS_ORIGINS: 'http://a.test, http://b.test',
      RENAISSANCE_HUB_ADMINS: 'sahil, Kevin',
      RENAISSANCE_HUB_DRY_RUN: 'yes',
      RENAISSANCE_HUB_TRUST_PROXY: '1',
      RENAISSANCE_BUDGET_USD_MONTH: '2.5',
      RENAISSANCE_HUB_DB: ':memory:',
      JELLYFIN_URL: 'http://jf.test:8096',
      JELLYFIN_API_KEY: 'k',
      NAVIDROME_URL: 'http://nd.test',
      NAVIDROME_USER: 'sahil',
      NAVIDROME_PASSWORD: 'pw',
      LIDARR_ROOT_FOLDER: '/files/media/music',
    });
    expect(c.port).toBe(9000);
    expect(c.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
    expect(c.admins).toEqual(['sahil', 'Kevin']);
    expect(c.dryRun).toBe(true);
    expect(c.trustProxy).toBe(true);
    expect(c.budgetUsdPerMonth).toBe(2.5);
    expect(c.jellyfin.url).toBe('http://jf.test:8096');
    expect(c.navidrome.user).toBe('sahil');
    expect(c.lidarr.rootFolder).toBe('/files/media/music');
  });

  it('rejects a bad port, URL or budget', () => {
    expect(() => loadConfig({ RENAISSANCE_HUB_PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadConfig({ JELLYFIN_URL: 'not a url' })).toThrow(ConfigError);
    expect(() => loadConfig({ RENAISSANCE_BUDGET_USD_MONTH: '-1' })).toThrow(ConfigError);
  });

  it('describe never includes secret values', () => {
    const c = loadConfig({
      ANTHROPIC_API_KEY: 'sk-test-value',
      LIDARR_API_KEY: 'lidarr-value',
      NAVIDROME_PASSWORD: 'nd-secret',
      RENAISSANCE_HUB_DB: ':memory:',
    });
    const text = JSON.stringify(describe(c));
    expect(text).not.toContain('sk-test-value');
    expect(text).not.toContain('lidarr-value');
    expect(text).not.toContain('nd-secret');
    expect(describe(c)).toMatchObject({
      anthropic: true,
      lidarr: false,
      navidrome: false,
      database: 'memory',
      budgetUsdPerMonth: 10,
    });
  });
});
