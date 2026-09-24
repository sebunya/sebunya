import Redis from 'ioredis';
import { logger } from '../logging/logger';

/**
 * Where the shadow target may point. Mirrored requests are live customer traffic,
 * so the target must be one of OUR hosts: a compose service name (single label,
 * e.g. `shadow-api`), loopback, or a host listed in SHADOW_TRAFFIC_ALLOWED_HOSTS.
 * An admin session used to be able to point it at any URL on the internet.
 */
export function isAllowedShadowHost(hostname: string, env: Record<string, string | undefined> = process.env): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(host)) return true;
  const allowed = (env.SHADOW_TRAFFIC_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(host);
}

/**
 * Paths never mirrored: money, provider callbacks, sign-in, admin, and every
 * customer-scoped surface (cart, checkout, account, consent, telemetry) — even
 * a credential-less read of those carries a customer's ids in the URL.
 */
export function isShadowablePath(path: string): boolean {
  return !(
    path.startsWith('/health') ||
    path.startsWith('/metrics') ||
    path.startsWith('/webhooks') ||
    path.startsWith('/commerce') ||
    path.startsWith('/account') ||
    path.startsWith('/consent') ||
    path.startsWith('/telemetry') ||
    path.startsWith('/measurement') ||
    path.startsWith('/auth') ||
    path.startsWith('/admin') ||
    path.startsWith('/internal')
  );
}

/**
 * Headers a mirrored request may carry. Every credential is dropped: session and
 * cookie, the storefront's cart / checkout / visit tokens, the internal key, any
 * *-token, *-signature or *-key header. A shadow host never receives an identity.
 */
export function shadowSafeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const n = name.toLowerCase();
    if (
      n === 'authorization' ||
      n === 'cookie' ||
      n.startsWith('x-goldplus-') ||
      n.startsWith('x-gp-') ||
      n.endsWith('-token') ||
      n.endsWith('-signature') ||
      n.endsWith('-key') ||
      n === 'content-length'
    ) continue;
    out[n] = value;
  }
  return out;
}

/** The shared flags, read by every replica. */
export interface DeploymentFlagStore {
  read(): Promise<{ maintenance: string | null; shadow: string | null }>;
  write(key: 'maintenance' | 'shadow', value: string): Promise<void>;
}

const FLAG_KEYS = { maintenance: 'deployment:maintenance', shadow: 'deployment:shadow' } as const;

function redisFlagStore(url: string): DeploymentFlagStore {
  const client = new Redis(url, {
    // On the request path: a slow Redis must cost milliseconds, not the request.
    connectTimeout: 1_000,
    commandTimeout: 250,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  client.on('error', (err) => logger.warn({ err: err.message }, '[DeploymentService] flag store Redis error'));
  return {
    async read() {
      const [maintenance, shadow] = await client.mget(FLAG_KEYS.maintenance, FLAG_KEYS.shadow);
      return { maintenance, shadow };
    },
    async write(key, value) {
      await client.set(FLAG_KEYS[key], value);
    },
  };
}

/** How long a replica trusts its last read of the shared flags. */
export const FLAG_CACHE_MS = 2_000;

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseShadowRatio(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return clampRatio(parsed);
}

function normalizeShadowUrl(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) return '';

  try {
    const url = new URL(normalized);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString().replace(/\/$/, '') : '';
  } catch {
    logger.warn({ shadowUrl: normalized }, '[DeploymentService] Ignoring invalid shadow traffic URL');
    return '';
  }
}

/**
 * The maintenance freeze and the shadow settings live in Redis, read by every
 * replica through a ~2s cache. They were fields on one process's singleton while
 * compose runs two API replicas: a freeze reached only the replica that took the
 * admin POST (about half of all writes kept succeeding), the status answer
 * alternated, and any restart silently lifted it — while the audit row said it
 * was on. When Redis cannot be read, a replica keeps what it last knew.
 */
export class DeploymentService {
  private static _instance: DeploymentService;
  private isFreeze = false;
  private healthScore = 100;
  private shadowRatio = parseShadowRatio(process.env.SHADOW_TRAFFIC_RATIO);
  private shadowUrl = normalizeShadowUrl(process.env.SHADOW_TRAFFIC_URL);
  private flagStore: DeploymentFlagStore | null | undefined;
  private flagsReadAt = 0;
  private flagsShared = false;

  private constructor() {}

  /** Test seam: a store to use instead of Redis (null = this process only). */
  public useFlagStore(store: DeploymentFlagStore | null): void {
    this.flagStore = store;
    this.flagsReadAt = 0;
  }

  private store(): DeploymentFlagStore | null {
    if (this.flagStore === undefined) {
      const url = process.env.REDIS_URL;
      this.flagStore = url && process.env.NODE_ENV !== 'test' ? redisFlagStore(url) : null;
    }
    return this.flagStore;
  }

  /** True when the last read of the shared flags succeeded (they apply to every replica). */
  public flagsAreShared(): boolean {
    return this.flagsShared;
  }

  /**
   * Re-reads the shared flags when the cached copy is older than FLAG_CACHE_MS
   * (or always, with `force`). Returns the maintenance state. Never throws.
   */
  public async refreshFlags(opts: { force?: boolean; now?: number } = {}): Promise<boolean> {
    const store = this.store();
    const now = opts.now ?? Date.now();
    if (!store || (!opts.force && now - this.flagsReadAt < FLAG_CACHE_MS)) return this.isFreeze;
    this.flagsReadAt = now;
    try {
      const flags = await store.read();
      this.isFreeze = flags.maintenance === '1';
      if (flags.shadow) {
        const shadow = JSON.parse(flags.shadow) as { ratio?: unknown; url?: unknown };
        this.shadowRatio = clampRatio(Number(shadow.ratio) || 0);
        this.shadowUrl = typeof shadow.url === 'string' ? normalizeShadowUrl(shadow.url) : '';
      }
      this.flagsShared = true;
    } catch (err) {
      this.flagsShared = false;
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[DeploymentService] shared flags unreadable; keeping last known');
    }
    return this.isFreeze;
  }

  private async share(key: 'maintenance' | 'shadow', value: string): Promise<boolean> {
    const store = this.store();
    if (!store) return false;
    try {
      await store.write(key, value);
      this.flagsReadAt = Date.now();
      this.flagsShared = true;
      return true;
    } catch (err) {
      this.flagsShared = false;
      logger.error({ err: err instanceof Error ? err.message : String(err), key }, '[DeploymentService] could not share flag; applied to THIS replica only');
      return false;
    }
  }

  public static getInstance(): DeploymentService {
    if (!DeploymentService._instance) {
      DeploymentService._instance = new DeploymentService();
    }
    return DeploymentService._instance;
  }

  public getMaintenanceMode(): boolean {
    return this.isFreeze;
  }

  /** Applies locally at once; resolves true when every replica will see it. */
  public setMaintenanceMode(enabled: boolean): Promise<boolean> {
    this.isFreeze = enabled;
    logger.warn({ enabled }, '[DeploymentService] Maintenance mode (write lock) toggled');
    return this.share('maintenance', enabled ? '1' : '0');
  }

  public getReleaseHealthScore(): number {
    return this.healthScore;
  }

  public updateHealthScore(score: number): void {
    this.healthScore = Math.max(0, Math.min(100, score));
    logger.info({ score: this.healthScore }, '[DeploymentService] Release health score updated');
  }

  public getShadowTrafficRatio(): number {
    return this.shadowRatio;
  }

  public setShadowTrafficRatio(ratio: number): Promise<boolean> {
    this.shadowRatio = clampRatio(ratio);
    return this.share('shadow', JSON.stringify({ ratio: this.shadowRatio, url: this.shadowUrl }));
  }

  public getShadowUrl(): string {
    return this.shadowUrl;
  }

  public hasShadowTarget(): boolean {
    return this.shadowUrl.length > 0;
  }

  public setShadowUrl(url: string | null): boolean {
    if (!url) {
      this.shadowUrl = '';
      return true;
    }

    const normalized = normalizeShadowUrl(url);
    if (!normalized || !isAllowedShadowHost(new URL(normalized).hostname)) {
      return false;
    }

    this.shadowUrl = normalized;
    return true;
  }

  /**
   * Mirrors a READ to the shadow target, without credentials, bounded.
   *
   * Writes are never mirrored: a shadow sharing the database would execute every
   * checkout, IPN and admin change twice. The body parameter is kept for call-site
   * compatibility and ignored.
   */
  public async mirrorTrafficIfSelected(
    reqUrl: string,
    method: string,
    headers: Record<string, string>,
    _bodyStr: string | null,
    fetchImpl: typeof fetch = fetch,
    random: () => number = Math.random,
  ): Promise<void> {
    if (!this.shadowUrl || this.shadowRatio <= 0) return;
    const verb = method.toUpperCase();
    if (verb !== 'GET' && verb !== 'HEAD') return;
    let path: string;
    try {
      path = new URL(reqUrl).pathname;
    } catch {
      return;
    }
    if (!isShadowablePath(path)) return;
    if (!isAllowedShadowHost(new URL(this.shadowUrl).hostname)) return;
    if (random() > this.shadowRatio) return; // Do not shadow this request

    const targetUrl = reqUrl.replace(/https?:\/\/[^/]+/, this.shadowUrl);
    fetchImpl(targetUrl, {
      method: verb,
      headers: { ...shadowSafeHeaders(headers), 'X-Shadow-Request': 'true' },
      signal: AbortSignal.timeout(2000),
    }).catch((err) => {
      logger.debug({ err, targetUrl }, '[DeploymentService] Shadow traffic mirror failed');
    });
  }
}
export const deploymentService = DeploymentService.getInstance();
