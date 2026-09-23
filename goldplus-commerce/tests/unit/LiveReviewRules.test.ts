import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { liveReviewHasBlockers, liveReviewNextActions } from '../../packages/shared/src/activation/liveReviewRules';

/**
 * The live-review page and the API read ONE set of rules. They had drifted: the
 * page offered "Run readiness checks" only for DRAFT (a status no candidate has),
 * so checks — and therefore approval — were impossible from the page. And the
 * dry-run route built a private in-memory canary planner, so a plan it validated
 * was invisible to live review ("Canary plan is missing", every time).
 */
const now = new Date('2026-09-23T12:00:00Z');
const later = new Date('2026-09-25T12:00:00Z');
const pass = { status: 'PASS' };

describe('liveReviewNextActions', () => {
  it('a fresh candidate (created READY_FOR_REVIEW) can run checks and build a runbook, but not be decided yet', () => {
    expect(liveReviewNextActions({ status: 'READY_FOR_REVIEW', checks: [], hasRunbook: false, activationWindowEnd: later, now }))
      .toEqual({ canRunChecks: true, canBuildRunbook: true, canDecide: false, decideBlockedBecause: 'Run the readiness checks first — a decision needs their results.' });
  });

  it('passing checks make it decidable; a built runbook is not offered again', () => {
    const r = liveReviewNextActions({ status: 'READY_FOR_REVIEW', checks: [pass, pass], hasRunbook: true, activationWindowEnd: later, now });
    expect(r).toMatchObject({ canRunChecks: true, canBuildRunbook: false, canDecide: true, decideBlockedBecause: null });
  });

  it('BLOCKED can only re-run checks, and says why', () => {
    const r = liveReviewNextActions({ status: 'BLOCKED', checks: [pass, { status: 'BLOCKED' }], hasRunbook: false, activationWindowEnd: later, now });
    expect(r).toMatchObject({ canRunChecks: true, canBuildRunbook: false, canDecide: false });
    expect(r.decideBlockedBecause).toMatch(/blockers/);
  });

  it('every blocking check status blocks; an expired window blocks; decided candidates offer nothing', () => {
    for (const s of ['BLOCKED', 'EXPIRED', 'NOT_CONFIGURED', 'CONSENT_BLOCKED']) expect(liveReviewHasBlockers([pass, { status: s }])).toBe(true);
    expect(liveReviewHasBlockers([pass, { status: 'WARNING' }])).toBe(false);
    expect(liveReviewNextActions({ status: 'READY_FOR_REVIEW', checks: [pass], hasRunbook: true, activationWindowEnd: now, now: later }).decideBlockedBecause).toMatch(/window has ended/);
    expect(liveReviewNextActions({ status: 'APPROVED_FOR_FUTURE_CONTROLLED_ACTIVATION', checks: [pass], hasRunbook: true, activationWindowEnd: later, now }))
      .toMatchObject({ canRunChecks: false, canBuildRunbook: false, canDecide: false });
  });
});

describe('one set of activation services per process', () => {
  it('no route constructs its own in-memory activation service (they must come from the Registry)', () => {
    const routes = path.resolve(__dirname, '../../apps/api/src');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('Registry.ts') && !p.includes(`${path.sep}infrastructure${path.sep}activation${path.sep}`)) {
          if (/new DefaultControlledActivation(CanaryPlanner|PayloadPreviewer|EvidencePackBuilder)\(/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(routes, p));
        }
      }
    };
    walk(routes);
    expect(offenders).toEqual([]);
  });
});
