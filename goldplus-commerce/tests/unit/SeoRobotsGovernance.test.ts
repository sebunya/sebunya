import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ROBOTS_STATUSES,
  canTransition,
  parseRobots,
  validateRobotsContent,
  blockingFindings,
  gateRobotsContent,
  checkApprover,
  diffRobots,
  validateRobotsDraft,
  fallbackRobotsTxt,
} from '../../apps/api/src/application/use-cases/seo-growth/RobotsGovernanceUseCases';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const SAFE = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /admin',
  'Disallow: /checkout',
  '',
  'Sitemap: https://shopgoldplus.com/sitemap.xml',
  '',
].join('\n');

// ── Lifecycle ───────────────────────────────────────────────────────────────

describe('robots.txt version lifecycle', () => {
  it('exposes exactly the statuses the CHECK constraint allows', () => {
    expect([...ROBOTS_STATUSES]).toEqual([
      'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'REJECTED',
    ]);
  });

  it('walks DRAFT -> PENDING_APPROVAL -> APPROVED -> PUBLISHED -> SUPERSEDED', () => {
    expect(canTransition('DRAFT', 'PENDING_APPROVAL')).toBe(true);
    expect(canTransition('PENDING_APPROVAL', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'PUBLISHED')).toBe(true);
    expect(canTransition('PUBLISHED', 'SUPERSEDED')).toBe(true);
  });

  it('refuses to publish a draft that skipped approval', () => {
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(false);
    expect(canTransition('PENDING_APPROVAL', 'PUBLISHED')).toBe(false);
  });

  it('treats SUPERSEDED and REJECTED as terminal, so history is never revived in place', () => {
    for (const to of ROBOTS_STATUSES) {
      expect(canTransition('SUPERSEDED', to)).toBe(false);
      expect(canTransition('REJECTED', to)).toBe(false);
    }
  });

  it('rejects unknown statuses rather than falling through', () => {
    expect(canTransition('LIVE', 'PUBLISHED')).toBe(false);
    expect(canTransition('DRAFT', 'LIVE')).toBe(false);
  });
});

// ── Content validation ──────────────────────────────────────────────────────

describe('robots.txt content validation refuses to deindex the site quietly', () => {
  it('raises a BLOCKING finding for Disallow: / under User-agent: *', () => {
    const findings = validateRobotsContent('User-agent: *\nDisallow: /\n');
    const blocking = blockingFindings(findings);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].code).toBe('ROBOTS_DISALLOW_ALL_WILDCARD');
    expect(blocking[0].line).toBe(2);
    expect(blocking[0].message).toMatch(/deindexes/i);
  });

  it('downgrades Disallow: / for a named agent to a WARNING, not a block', () => {
    const findings = validateRobotsContent('User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nAllow: /\nDisallow: /admin\nSitemap: https://x/y.xml\n');
    expect(blockingFindings(findings)).toHaveLength(0);
    expect(findings.some((f) => f.code === 'ROBOTS_DISALLOW_ALL_AGENT' && f.severity === 'WARNING')).toBe(true);
  });

  it('ignores a Disallow: / that is commented out', () => {
    const findings = validateRobotsContent(`${SAFE}# Disallow: /\n`);
    expect(blockingFindings(findings)).toHaveLength(0);
  });

  it('blocks empty content — an empty robots.txt is never publishable', () => {
    expect(blockingFindings(validateRobotsContent('   \n')).map((f) => f.code)).toEqual(['ROBOTS_EMPTY']);
  });

  it('flags content with no User-agent group at all', () => {
    expect(blockingFindings(validateRobotsContent('Sitemap: https://x/y.xml\n')).map((f) => f.code))
      .toEqual(['ROBOTS_NO_GROUPS']);
  });

  it('notes a missing sitemap and an exposed /admin without blocking', () => {
    const findings = validateRobotsContent('User-agent: *\nAllow: /\n');
    expect(blockingFindings(findings)).toHaveLength(0);
    expect(findings.map((f) => f.code)).toContain('ROBOTS_NO_SITEMAP');
    expect(findings.map((f) => f.code)).toContain('ROBOTS_ADMIN_EXPOSED');
  });

  it('passes a healthy robots.txt with no findings above INFO', () => {
    const findings = validateRobotsContent(SAFE);
    expect(findings.filter((f) => f.severity !== 'INFO')).toHaveLength(0);
  });

  it('groups consecutive User-agent lines into one block', () => {
    const groups = parseRobots('User-agent: A\nUser-agent: B\nDisallow: /x\n\nUser-agent: *\nAllow: /\n');
    expect(groups).toHaveLength(2);
    expect(groups[0].agents).toEqual(['A', 'B']);
    expect(groups[0].disallow[0].value).toBe('/x');
  });
});

describe('the risk gate refuses rather than rewriting operator input', () => {
  const risky = 'User-agent: *\nDisallow: /\n';

  it('refuses a blocking change with a typed code', () => {
    const gate = gateRobotsContent(risky, undefined);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.code).toBe('ROBOTS_RISK_NOT_ACKNOWLEDGED');
  });

  it('never alters the submitted content', () => {
    const draft = validateRobotsDraft({ content: risky, acknowledgeRisk: true });
    expect(draft.ok).toBe(true);
    expect(draft.ok === true && draft.input.content).toBe(risky);
  });

  it('proceeds only on an explicit acknowledgeRisk: true, and records what was acknowledged', () => {
    expect(gateRobotsContent(risky, 'true').ok).toBe(false);
    expect(gateRobotsContent(risky, 1).ok).toBe(false);
    const gate = gateRobotsContent(risky, true);
    expect(gate.ok).toBe(true);
    expect(gate.ok === true && gate.acknowledged.map((f) => f.code)).toEqual(['ROBOTS_DISALLOW_ALL_WILDCARD']);
  });

  it('needs no acknowledgement for safe content', () => {
    const gate = gateRobotsContent(SAFE, undefined);
    expect(gate.ok).toBe(true);
    expect(gate.ok === true && gate.acknowledged).toEqual([]);
  });

  it('refuses an empty draft outright', () => {
    const draft = validateRobotsDraft({ content: '  ' });
    expect(draft.ok === false && draft.code).toBe('CONTENT_REQUIRED');
  });
});

// ── Separation of duties ────────────────────────────────────────────────────

describe('approval is separated from authorship', () => {
  it('refuses when the approver is the author', () => {
    const check = checkApprover('user-1', 'user-1');
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.code).toBe('SEPARATION_OF_DUTIES');
  });

  it('accepts a different approver', () => {
    expect(checkApprover('user-1', 'user-2').ok).toBe(true);
  });

  it('requires an approver identity at all', () => {
    expect(checkApprover('user-1', '').ok).toBe(false);
    expect(checkApprover('user-1', null).ok).toBe(false);
  });
});

// ── Diff ────────────────────────────────────────────────────────────────────

describe('the unified diff is pure and needs no database', () => {
  it('reports identical content as identical with an empty unified body', () => {
    const d = diffRobots(SAFE, SAFE);
    expect(d.identical).toBe(true);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
    expect(d.unified).toBe('');
  });

  it('counts a single added line', () => {
    const d = diffRobots('User-agent: *\nAllow: /\n', 'User-agent: *\nAllow: /\nDisallow: /admin\n');
    expect(d.identical).toBe(false);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(0);
    expect(d.unified).toContain('+Disallow: /admin');
  });

  it('counts a single removed line', () => {
    const d = diffRobots('User-agent: *\nAllow: /\nDisallow: /admin\n', 'User-agent: *\nAllow: /\n');
    expect(d.added).toBe(0);
    expect(d.removed).toBe(1);
    expect(d.unified).toContain('-Disallow: /admin');
  });

  it('shows a replacement as one removal and one addition', () => {
    const d = diffRobots('User-agent: *\nAllow: /\n', 'User-agent: *\nDisallow: /\n');
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.unified).toContain('-Allow: /');
    expect(d.unified).toContain('+Disallow: /');
  });

  it('emits hunk headers with line numbers an operator can act on', () => {
    const d = diffRobots(SAFE, SAFE.replace('Disallow: /admin', 'Disallow: /admin\nDisallow: /cart'));
    expect(d.hunks.length).toBeGreaterThan(0);
    expect(d.hunks[0].header).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/);
    const added = d.hunks.flatMap((h) => h.lines).filter((l) => l.op === 'add');
    expect(added).toHaveLength(1);
    expect(added[0].text).toBe('Disallow: /cart');
    expect(added[0].fromLine).toBeNull();
    expect(added[0].toLine).toBe(4);
  });

  it('handles an empty "from" (the first ever version) without throwing', () => {
    const d = diffRobots('', SAFE);
    expect(d.identical).toBe(false);
    expect(d.removed).toBe(0);
    expect(d.added).toBeGreaterThan(0);
  });

  it('is not fooled by a trailing-newline-only difference', () => {
    expect(diffRobots('a\nb\n', 'a\nb').identical).toBe(true);
  });
});

// ── Rollback and fallback ───────────────────────────────────────────────────

describe('rollback creates a new version instead of mutating history', () => {
  it('carries restoredFromId through validation', () => {
    const draft = validateRobotsDraft({ content: SAFE, restoredFromId: 'abc-123', note: 'Rollback to v2.' });
    expect(draft.ok).toBe(true);
    expect(draft.ok === true && draft.input.restoredFromId).toBe('abc-123');
  });

  it('is wired as an insert, never an update, in the route and repository', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/seo-robots.ts');
    expect(route).toMatch(/rollback[\s\S]*createRobotsDraft/);
    expect(route).not.toMatch(/update seo_robots_versions/);
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleSeoTechnicalRepository.ts');
    expect(repo).not.toMatch(/delete from seo_robots_versions/);
  });

  it('supersedes the incumbent in the same transaction so one PUBLISHED row holds', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleSeoTechnicalRepository.ts');
    expect(repo).toMatch(/db\.transaction/);
    expect(repo).toMatch(/set status = 'SUPERSEDED'/);
  });
});

describe('the storefront never serves an empty or broken robots.txt', () => {
  it('the fallback blocks admin, checkout and the API, and advertises the sitemap', () => {
    const body = fallbackRobotsTxt('https://shopgoldplus.com/');
    expect(body).toContain('Disallow: /admin');
    expect(body).toContain('Disallow: /checkout');
    expect(body).toContain('Disallow: /api/');
    expect(body).toContain('Sitemap: https://shopgoldplus.com/sitemap.xml');
    expect(blockingFindings(validateRobotsContent(body))).toHaveLength(0);
  });

  it('the Astro route falls back on an unreachable API and on an empty published body', () => {
    const page = read('apps/web/src/pages/robots.txt.ts');
    expect(page).toMatch(/staticRobots\(base\)/);
    expect(page).toMatch(/catch\s*\{\s*return null;/);
    expect(page).toMatch(/body\.trim\(\) === ''/);
  });
});

// ── Permission wiring ───────────────────────────────────────────────────────

describe('permissions are enforced on every robots handler', () => {
  const route = read('apps/api/src/interfaces/http/routes/admin/seo-robots.ts');

  it('uses SEO_ROBOTS_MANAGE for mutations and SEO_VIEW for reads', () => {
    expect(route).toContain('PERMISSIONS.SEO_ROBOTS_MANAGE');
    expect(route).toContain('PERMISSIONS.SEO_VIEW');
  });

  it('requires SEO_APPROVE_HIGH_RISK to approve and to publish', () => {
    expect(route).toMatch(/'\/:id\/approve',\s*\n\s*requirePermissions\(\[PERMISSIONS\.SEO_ROBOTS_MANAGE, PERMISSIONS\.SEO_APPROVE_HIGH_RISK\]\)/);
    expect(route).toMatch(/'\/:id\/publish',\s*\n\s*requirePermissions\(\[PERMISSIONS\.SEO_ROBOTS_MANAGE, PERMISSIONS\.SEO_APPROVE_HIGH_RISK\]\)/);
  });

  it('audits every mutation', () => {
    const mutations = route.match(/routes\.(post|patch|delete)\(/g) ?? [];
    const audits = route.match(/await audit\(c,/g) ?? [];
    // /validate is a dry run that writes nothing, so it has no audit entry.
    expect(mutations.length).toBeGreaterThan(0);
    expect(audits.length).toBe(mutations.length - 1);
  });
});
