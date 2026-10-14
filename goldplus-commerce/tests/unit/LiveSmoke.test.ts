import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 2026-10-14: a week of refused form posts went unseen by GET-only checks. Every deploy now ends with a real form post. */
describe('live smoke after every deploy', () => {
  const smoke = readFileSync(join(__dirname, '../../scripts/live-smoke.sh'), 'utf8');
  const deploy = readFileSync(join(__dirname, '../../scripts/deploy-prod.sh'), 'utf8');
  it('posts real forms with the shop origin and fails on either refusal, and checks a foreign origin is refused', () => {
    for (const p of ['/cart', '/checkout', '/login', '/quote-request']) expect(smoke).toContain(p);
    expect(smoke).toContain('post "$path" "$SITE"');
    // Both refusals: Astro's and the shop's own origin check.
    expect(smoke).toContain("grep -qiE 'Cross-site|could not be verified'");
    // No answer is a failure, never an \"ok\".
    expect(smoke).toContain('[ "$code" = 000 ]');
    expect(smoke).toContain('https://evil.example');
    expect(smoke).toContain('exit 1');
  });
  it('is the last step of deploy-prod.sh and fails the deploy when customers are affected', () => {
    const tail = deploy.slice(deploy.lastIndexOf('scripts/live-smoke.sh') - 200);
    expect(tail).toContain('scripts/live-smoke.sh ||');
    expect(tail).toContain('exit 1');
    expect(deploy.trim().endsWith('fi')).toBe(true);
  });
});
