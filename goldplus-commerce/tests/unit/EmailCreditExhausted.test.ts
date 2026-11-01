import { describe, expect, it } from 'vitest';
import { classifyTransactionalEmailFailure } from '../../apps/api/src/application/services/consent/TransactionalEmailFailureForensics';

/**
 * ZeptoMail answers HTTP 429 for two completely different problems: a burst to
 * slow down for, and an account with no credit left. Production only ever saw
 * the second — TM_5001 / LE_102 "Credit exhausted" — and reported it as
 * `rate_limited, retryable=yes`, so it retried 244 times over six weeks while
 * every surface implied a passing blip. Nobody was ever told the one thing that
 * would fix it: buy credit. Proven live 2026-09-20; the key, sender domain and
 * endpoint were all fine.
 */
const ZEPTO_CREDIT_BODY = '{"error":{"code":"TM_5001","details":[{"code":"LE_102","message":"Credit exhausted"}],"message":"Resource Limit Exhausted."}}';

describe('an exhausted credit balance is not a rate limit', () => {
  it('reads the provider body rather than the status code', () => {
    const f = classifyTransactionalEmailFailure({ response_status: 429, provider_code: ZEPTO_CREDIT_BODY });
    expect(f.classification).toBe('credit_exhausted');
    expect(f.retryable).toBe('no');
    expect(f.requires_provider_action).toBe(true);
    expect(f.safe_local_fix_available).toBe(false);
  });

  it('still recognises a genuine rate limit as one', () => {
    const f = classifyTransactionalEmailFailure({
      response_status: 429,
      provider_code: '{"error":{"message":"Too many requests, please slow down"}}',
    });
    expect(f.classification).toBe('rate_limited');
    expect(f.retryable).toBe('yes');
  });

  it('a bare 429 with no body still falls back to rate limited', () => {
    expect(classifyTransactionalEmailFailure({ response_status: 429 }).classification).toBe('rate_limited');
  });

  it('recognises the other wordings providers use for the same thing', () => {
    for (const body of ['Insufficient credits on this account', 'Your quota has been exceeded', 'no credits remaining']) {
      expect(classifyTransactionalEmailFailure({ response_status: 429, provider_code: body }).classification)
        .toBe('credit_exhausted');
    }
  });
});
