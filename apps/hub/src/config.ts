/**
 * Hub configuration. Reads environment variables only: no config files, no CLI flags, nothing in the
 * repo. `.env` is loaded by Node itself (`--env-file-if-exists=.env` in the package scripts), so this
 * module still sees nothing but `process.env`. Secrets are typed as `secret` so they are never logged;
 * `describe()` prints presence, not values.
 */
import { z } from 'zod';

/** Absent or blank means "not configured"; anything else must be a URL. */
const optionalUrl = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))
  .pipe(z.url().optional());

/** Absent or blank means "not configured". Never logged. */
const secret = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const optionalText = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const list = z
  .string()
  .trim()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const flag = z
  .string()
  .trim()
  .default('false')
  .transform((v) => ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

/** The web app's Vite dev server; allowed by default outside production so a fresh clone just works. */
export const DEV_CORS_ORIGINS = ['http://localhost:5173'] as const;

const schema = z.object({
  NODE_ENV: z.string().trim().default('development'),
  RENAISSANCE_HUB_HOST: z.string().trim().min(1).default('0.0.0.0'),
  RENAISSANCE_HUB_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  /** Requests per minute per client address; 0 turns the limit off. */
  RENAISSANCE_HUB_RATE_LIMIT: z.coerce.number().int().min(0).default(120),
  RENAISSANCE_HUB_CORS_ORIGINS: list,
  /** Behind a reverse proxy: trust `x-forwarded-for` so the rate limit sees the client, not the proxy. */
  RENAISSANCE_HUB_TRUST_PROXY: flag,
  /** SQLite file for the household database; `:memory:` keeps nothing. */
  RENAISSANCE_HUB_DB: z.string().trim().min(1).default('./data/hub.sqlite'),
  /**
   * Lets the model break a tie the deterministic ranking cannot (two files within a few points).
   * Off by default; with no `ANTHROPIC_API_KEY` it stays off whatever this says.
   */
  RENAISSANCE_FETCH_MODEL_PICK: flag,
  /** Log every slskd and Lidarr write instead of doing it; searches still run. */
  RENAISSANCE_HUB_DRY_RUN: flag,
  /** Days an album request waits on Lidarr before it fails with `not_found_in_time`. */
  RENAISSANCE_ALBUM_DEADLINE_DAYS: z.coerce.number().min(0).default(7),
  /** The slskd completed-downloads folder as Lidarr's container sees it. */
  RENAISSANCE_LIDARR_DOWNLOADS_DIR: z.string().trim().min(1).default('/downloads/complete'),
  /** Where soularr parks files Lidarr refused to import, as Lidarr sees it; the hub files them from there. */
  RENAISSANCE_LIDARR_FAILED_IMPORTS_DIR: optionalText,
  /** Lidarr root folder for new artists; empty takes Lidarr's first root folder. */
  LIDARR_ROOT_FOLDER: optionalText,
  JELLYFIN_URL: optionalUrl,
  JELLYFIN_API_KEY: secret,
  ANTHROPIC_API_KEY: secret,
  ANTHROPIC_INTENT_MODEL: z.string().trim().min(1).default('claude-opus-5-5'),
  ANTHROPIC_ENRICHMENT_MODEL: z.string().trim().min(1).default('claude-haiku-5-5'),
  LIDARR_URL: optionalUrl,
  LIDARR_API_KEY: secret,
  SLSKD_URL: optionalUrl,
  SLSKD_API_KEY: secret,
  NAVIDROME_URL: optionalUrl,
  NAVIDROME_USER: optionalText,
  NAVIDROME_PASSWORD: secret,
  /** Sent to MusicBrainz as the User-Agent contact, as its etiquette asks. */
  RENAISSANCE_CONTACT: optionalText,
});

export interface HubConfig {
  /** `production` or anything else; only CORS defaults depend on it. */
  environment: string;
  host: string;
  port: number;
  /** Browser origins allowed to call the hub. Empty means same origin only. */
  corsOrigins: string[];
  /** Requests per minute one client address may make; 0 means no limit. */
  rateLimitPerMinute: number;
  trustProxy: boolean;
  databasePath: string;
  /** True only when `RENAISSANCE_FETCH_MODEL_PICK` is on and a key is set. */
  modelPick: boolean;
  dryRun: boolean;
  /** Milliseconds an album request may wait on Lidarr. */
  albumDeadlineMs: number;
  lidarrDownloadsDir: string;
  lidarrFailedImportsDir: string | undefined;
  contact: string | undefined;
  jellyfin: { url: string | undefined; apiKey: string | undefined };
  anthropic: { apiKey: string | undefined; intentModel: string; enrichmentModel: string };
  lidarr: { url: string | undefined; apiKey: string | undefined; rootFolder: string | undefined };
  slskd: { url: string | undefined; apiKey: string | undefined };
  navidrome: { url: string | undefined; user: string | undefined; password: string | undefined };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): HubConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid hub configuration: ${issues}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const corsOrigins =
    e.RENAISSANCE_HUB_CORS_ORIGINS.length > 0 || production
      ? e.RENAISSANCE_HUB_CORS_ORIGINS
      : [...DEV_CORS_ORIGINS];
  return {
    environment: e.NODE_ENV,
    host: e.RENAISSANCE_HUB_HOST,
    port: e.RENAISSANCE_HUB_PORT,
    corsOrigins,
    rateLimitPerMinute: e.RENAISSANCE_HUB_RATE_LIMIT,
    trustProxy: e.RENAISSANCE_HUB_TRUST_PROXY,
    databasePath: e.RENAISSANCE_HUB_DB,
    modelPick: e.RENAISSANCE_FETCH_MODEL_PICK && e.ANTHROPIC_API_KEY !== undefined,
    dryRun: e.RENAISSANCE_HUB_DRY_RUN,
    albumDeadlineMs: e.RENAISSANCE_ALBUM_DEADLINE_DAYS * 24 * 60 * 60_000,
    lidarrDownloadsDir: e.RENAISSANCE_LIDARR_DOWNLOADS_DIR,
    lidarrFailedImportsDir: e.RENAISSANCE_LIDARR_FAILED_IMPORTS_DIR,
    contact: e.RENAISSANCE_CONTACT,
    jellyfin: { url: e.JELLYFIN_URL, apiKey: e.JELLYFIN_API_KEY },
    anthropic: {
      apiKey: e.ANTHROPIC_API_KEY,
      intentModel: e.ANTHROPIC_INTENT_MODEL,
      enrichmentModel: e.ANTHROPIC_ENRICHMENT_MODEL,
    },
    lidarr: { url: e.LIDARR_URL, apiKey: e.LIDARR_API_KEY, rootFolder: e.LIDARR_ROOT_FOLDER },
    slskd: { url: e.SLSKD_URL, apiKey: e.SLSKD_API_KEY },
    navidrome: { url: e.NAVIDROME_URL, user: e.NAVIDROME_USER, password: e.NAVIDROME_PASSWORD },
  };
}

/** Safe to log: says which integrations are configured, never a value. */
export function describe(config: HubConfig): Record<string, string | number | boolean> {
  return {
    environment: config.environment,
    host: config.host,
    port: config.port,
    corsOrigins: config.corsOrigins.length,
    rateLimitPerMinute: config.rateLimitPerMinute,
    trustProxy: config.trustProxy,
    database: config.databasePath === ':memory:' ? 'memory' : 'file',
    modelPick: config.modelPick,
    dryRun: config.dryRun,
    albumDeadlineDays: config.albumDeadlineMs / (24 * 60 * 60_000),
    jellyfin: config.jellyfin.url !== undefined && config.jellyfin.apiKey !== undefined,
    anthropic: config.anthropic.apiKey !== undefined,
    intentModel: config.anthropic.intentModel,
    enrichmentModel: config.anthropic.enrichmentModel,
    lidarr: config.lidarr.url !== undefined && config.lidarr.apiKey !== undefined,
    slskd: config.slskd.url !== undefined && config.slskd.apiKey !== undefined,
    navidrome:
      config.navidrome.url !== undefined &&
      config.navidrome.user !== undefined &&
      config.navidrome.password !== undefined,
  };
}
