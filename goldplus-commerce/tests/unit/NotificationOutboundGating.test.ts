import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Outbound customer communication is the least reversible thing this platform
 * can do. A message sent to a real customer cannot be recalled, so the gates
 * that hold it back are worth asserting structurally, not just trusting.
 *
 * The gates themselves were found sound and are preserved. The defect was in the
 * PREFLIGHT that reports on them: it returned status 'PASS' in exactly the
 * arrangement it exists to detect — outbound email unlocked with the dry-run
 * guard off — with the warning buried in a message string. Anything scanning
 * statuses, or any dashboard keyed on them, saw PASS.
 */

const email = readFileSync(
  join(__dirname, '../../apps/api/src/infrastructure/notifications/zeptomail/ZeptoMailAdapter.ts'),
  'utf8',
);
const sms = readFileSync(
  join(__dirname, '../../apps/api/src/infrastructure/notifications/sms/PahappaCommsSmsAdapter.ts'),
  'utf8',
);

const dispatchOf = (source: string) =>
  source.slice(source.indexOf('async dispatch('), source.indexOf('async getBalance('));

describe.each([
  ['email', email],
  ['sms', sms],
])('%s outbound gates come before the network call', (_name, source) => {
  const dispatch = dispatchOf(source);

  it('checks the dry-run guard and the live-send flag before dispatching', () => {
    const dryRun = dispatch.indexOf('if (dryRun)');
    const live = dispatch.indexOf('if (!liveEnabled)');
    const call = dispatch.search(/await (resilientFetch|fetch)\(/);
    expect(dryRun).toBeGreaterThan(-1);
    expect(live).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    expect(dryRun).toBeLessThan(call);
    expect(live).toBeLessThan(call);
  });

  it('requires an explicit opt-in rather than treating absence as enabled', () => {
    // `=== 'true'` means unset, empty, "1", "yes" and a typo all leave it off.
    expect(source).toContain("process.env.NOTIFICATIONS_LIVE_SEND_ENABLED === 'true'");
    expect(source).not.toMatch(/NOTIFICATIONS_LIVE_SEND_ENABLED\s*!==\s*'false'/);
  });

  it('refuses when the channel itself is disabled', () => {
    expect(dispatch).toContain("providerCode: 'CHANNEL_DISABLED'");
  });
});

describe('the outbound safety preflight cannot pass while unsafe', () => {
  const preflight = email.slice(email.indexOf('async getBalance('));

  it('reports WARN, not PASS, when dry-run defaults are not enforced', () => {
    expect(preflight).toContain("status: 'WARN'");
    const branch = preflight.slice(preflight.indexOf('if (emailEnabled || liveSendEnabled || !dryRun)'));
    const decision = branch.slice(0, branch.indexOf('}'));
    expect(decision).not.toContain("status: 'PASS'");
  });

  it('names which specific guard is unlocked', () => {
    // "something is wrong" is not actionable at 3am.
    for (const marker of [
      'NOTIFICATIONS_EMAIL_ENABLED',
      'NOTIFICATIONS_LIVE_SEND_ENABLED',
      'NOTIFICATIONS_DRY_RUN is not true',
    ]) {
      expect(preflight).toContain(marker);
    }
  });

  it('still reports PASS when the environment is genuinely locked down', () => {
    const tail = preflight.slice(preflight.lastIndexOf("status: 'PASS'"));
    expect(tail).toContain('Safe dry-run defaults are active');
  });

  it('declares WARN in its own signature rather than smuggling it', () => {
    expect(email).toContain("'PASS' | 'WARN' | 'FAIL' | 'NOT_CONFIGURED'");
  });
});
