import { logger } from '../logging/logger';

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

export class DeploymentService {
  private static _instance: DeploymentService;
  private isFreeze = false;
  private healthScore = 100;
  private shadowRatio = parseShadowRatio(process.env.SHADOW_TRAFFIC_RATIO);
  private shadowUrl = normalizeShadowUrl(process.env.SHADOW_TRAFFIC_URL);

  private constructor() {}

  public static getInstance(): DeploymentService {
    if (!DeploymentService._instance) {
      DeploymentService._instance = new DeploymentService();
    }
    return DeploymentService._instance;
  }

  public getMaintenanceMode(): boolean {
    return this.isFreeze;
  }

  public setMaintenanceMode(enabled: boolean): void {
    this.isFreeze = enabled;
    logger.warn({ enabled }, '[DeploymentService] Maintenance mode (write lock) toggled');
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

  public setShadowTrafficRatio(ratio: number): void {
    this.shadowRatio = clampRatio(ratio);
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
    if (!normalized) {
      return false;
    }

    this.shadowUrl = normalized;
    return true;
  }

  public async mirrorTrafficIfSelected(reqUrl: string, method: string, headers: Record<string, string>, bodyStr: string | null): Promise<void> {
    if (!this.shadowUrl || this.shadowRatio <= 0) {
      return;
    }

    if (Math.random() > this.shadowRatio) {
      return; // Do not shadow this request
    }

    const targetUrl = reqUrl.replace(/https?:\/\/[^/]+/, this.shadowUrl);
    
    // Asynchronously POST/GET to shadow server without waiting for response
    fetch(targetUrl, {
      method,
      headers: {
        ...headers,
        'X-Shadow-Request': 'true',
      },
      body: bodyStr || undefined,
    }).catch((err) => {
      logger.debug({ err, targetUrl }, '[DeploymentService] Shadow traffic mirror failed');
    });
  }
}
export const deploymentService = DeploymentService.getInstance();
