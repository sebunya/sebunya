import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** ops/loyalty/reset-test-data.sh — run once on 2026-10-07: every order so far was a test. */
const s = readFileSync(join(__dirname, '../../ops/loyalty/reset-test-data.sh'), 'utf8');

describe('loyalty test-data reset script', () => {
  it('is a dry run unless --apply AND the typed confirmation are both given', () => {
    expect(s).toMatch(/MODE="\$\{1:-dry-run\}"/);
    expect(s).toMatch(/if \[ "\$MODE" != "--apply" \]; then[\s\S]*?exit 0/);
    expect(s).toMatch(/\[ "\$\{CONFIRM:-\}" = "RESET-LOYALTY" \] \|\| \{ echo "STOP/);
  });

  it('backs up before it changes anything, and stops on an empty backup', () => {
    expect(s.indexOf('pgdump_run')).toBeLessThan(s.indexOf('truncate $TLIST'));
    expect(s).toMatch(/\[ -s "\$DUMP" \] \|\| \{ echo "STOP: empty backup, nothing changed"; exit 1; \}/);
  });

  it('empties customer data in one transaction and keeps the programme itself', () => {
    const tx = s.slice(s.indexOf('begin;'), s.indexOf('commit;'));
    expect(tx).toMatch(/truncate \$TLIST;/);
    expect(tx).not.toMatch(/cascade/i);
    for (const kept of ['loyalty_config', 'loyalty_rules', 'loyalty_tiers', 'gamification_missions', 'gamification_badges', 'loyalty_draw_prizes', 'orders', 'users']) {
      expect(s.match(/TABLES="([\s\S]*?)"/)![1].split(/\s+/)).not.toContain(kept);
    }
  });

  it('never switches off the append-only ledger guard', () => {
    expect(s).not.toMatch(/disable trigger/i);
  });

  it('cancels queued loyalty messages and records the old campaign counters before zeroing them', () => {
    expect(s).toMatch(/where is_processed = false and event_type like 'LOYALTY\\_%'/);
    expect(s.indexOf("'LOYALTY_TEST_DATA_RESET'")).toBeLessThan(s.indexOf('set points_awarded = 0, tokens_granted = 0'));
  });
});
