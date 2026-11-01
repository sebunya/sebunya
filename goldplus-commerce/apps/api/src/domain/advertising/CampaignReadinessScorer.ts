/**
 * Campaign readiness (0-100), stored on campaigns.readiness_score.
 *
 * The original scorer took a product (image, retail price, stock), but a
 * campaign row has no product link, so the score is computed only from what a
 * campaign actually carries. Each check is worth fixed points:
 *   - name set ............................. 10
 *   - objective set ........................ 10
 *   - channel set .......................... 10
 *   - target URL on https://shopgoldplus.com 35
 *   - at least one UTM link ................ 35
 * `missing` lists the checks that failed, so the admin sees why.
 * Pure domain logic: no framework or database imports.
 */
export interface CampaignReadinessInput {
  name: string | null | undefined;
  objective: string | null | undefined;
  channel: string | null | undefined;
  targetUrl: string | null | undefined;
  utmLinkCount: number;
}

export interface CampaignReadiness {
  score: number;
  missing: string[];
}

const TARGET_URL = /^https:\/\/(www\.)?shopgoldplus\.com(\/|$)/;

export class CampaignReadinessScorer {
  score(input: CampaignReadinessInput): CampaignReadiness {
    const checks: Array<[boolean, number, string]> = [
      [Boolean(input.name?.trim()), 10, 'name'],
      [Boolean(input.objective?.trim()), 10, 'objective'],
      [Boolean(input.channel?.trim()), 10, 'channel'],
      [typeof input.targetUrl === 'string' && TARGET_URL.test(input.targetUrl), 35, 'targetUrl'],
      [input.utmLinkCount > 0, 35, 'utmLink'],
    ];
    let score = 0;
    const missing: string[] = [];
    for (const [passed, points, key] of checks) {
      if (passed) score += points;
      else missing.push(key);
    }
    return { score, missing };
  }
}
