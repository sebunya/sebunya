import { describe, expect, it } from 'vitest';
import { GoogleOAuthService } from '../../apps/api/src/infrastructure/seo/GoogleOAuthService';

/**
 * The state lived in the Map of the replica that served /start; Google's callback
 * reached the other replica about half the time and the grant was thrown away.
 */
const SECRET = 'unit-test-oauth-secret-0123456789abcdef';

describe('an OAuth state issued on one replica is accepted on another', () => {
  it('carries the connection, actor and PKCE verifier sealed inside it', () => {
    const replicaA = new GoogleOAuthService(SECRET, {});
    const replicaB = new GoogleOAuthService(SECRET, {});
    const { state, verifier } = replicaA.createState('conn-1', 'actor-1');
    expect(state).not.toContain(verifier);
    const record = replicaB.consumeState(state);
    expect(record).toMatchObject({ connectionId: 'conn-1', actorId: 'actor-1', verifier });
  });

  it('is still refused under a different key, when expired, or replayed on the same replica', () => {
    let now = 1_000_000;
    const svc = new GoogleOAuthService(SECRET, {}, () => now);
    const { state } = svc.createState('conn-1', 'actor-1');
    expect(new GoogleOAuthService('another-secret-entirely-0123456789', {}, () => now).consumeState(state)).toBeNull();
    expect(svc.consumeState(state)).not.toBeNull();
    expect(svc.consumeState(state)).toBeNull();
    const { state: late } = svc.createState('conn-1', 'actor-1');
    now += 11 * 60 * 1000;
    expect(svc.consumeState(late)).toBeNull();
  });
});
