import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hs256TokenSigner } from '../../apps/api/src/infrastructure/security/Hs256TokenSigner';

/** 0187: the access token names its sign-in session, so two-step verification is fresh per session, not per account. */
describe('the access token carries its session', () => {
  const signer = new Hs256TokenSigner('s'.repeat(40));

  it('sign() writes sid when given one, and verify() returns it', async () => {
    const withSession = await signer.verify(await signer.sign({ subject: 'u1', email: 'a@b.com', ttlSeconds: 60, sessionId: 'fam-1' }));
    expect(withSession).toMatchObject({ subject: 'u1', sessionId: 'fam-1' });
    const without = await signer.verify(await signer.sign({ subject: 'u1', email: 'a@b.com', ttlSeconds: 60 }));
    expect(without?.sessionId).toBeUndefined();
  });

  it('sign-in and refresh both name the session family; step-up checks it', () => {
    const read = (f: string) => readFileSync(join(__dirname, '../../apps/api/src', f), 'utf8');
    const auth = read('interfaces/http/routes/auth.ts');
    expect(auth).toMatch(/sign\(\{ subject: user\.id, email: user\.email, ttlSeconds, sessionId: refresh\.familyId \}\)/);
    expect(auth).toMatch(/sessionId: result\.session\.familyId,/);
    expect(auth).toMatch(/svc\.verify\(user\.id, code, new Date\(\), user\.sessionId\)/);
    expect(read('interfaces/http/middleware/requireStepUp.ts')).toMatch(/gate\(user\.id, action, new Date\(\), user\.sessionId \?\? null\)/);
    expect(read('interfaces/http/middleware/liveSession.ts')).toMatch(/sessionId: verified\.sessionId \?\? null/);
  });
});
