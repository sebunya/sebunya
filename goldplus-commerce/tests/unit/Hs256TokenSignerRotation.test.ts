import { describe, it, expect } from 'vitest';
import { Hs256TokenSigner } from '../../apps/api/src/infrastructure/security/Hs256TokenSigner';

const A = 'secret-A-'.padEnd(40, 'a');
const B = 'secret-B-'.padEnd(40, 'b');
const C = 'secret-C-'.padEnd(40, 'c');

const sign = (signer: Hs256TokenSigner) =>
  signer.sign({ subject: 'u1', email: 'u1@example.com', ttlSeconds: 900 });

describe('Hs256TokenSigner — dual-key rotation window (§14)', () => {
  it('a token signed with the PREVIOUS secret still verifies after rotation', async () => {
    const oldSigner = new Hs256TokenSigner(A);
    const token = await sign(oldSigner);

    // Post-rotation: current = B, previous = A.
    const rotated = new Hs256TokenSigner(B, A);
    const verified = await rotated.verify(token);
    expect(verified?.subject).toBe('u1');
  });

  it('tokens signed with the CURRENT secret verify', async () => {
    const rotated = new Hs256TokenSigner(B, A);
    const token = await sign(rotated); // signs with current (B)
    expect((await rotated.verify(token))?.email).toBe('u1@example.com');
    // sign always uses the CURRENT secret, never the previous one.
    const onlyA = new Hs256TokenSigner(A);
    expect(await onlyA.verify(token)).toBeNull();
  });

  it('rejects a token signed with an unrelated secret', async () => {
    const evil = await sign(new Hs256TokenSigner(C));
    const rotated = new Hs256TokenSigner(B, A);
    expect(await rotated.verify(evil)).toBeNull();
  });

  it('ignores a too-short previous secret (no weakening)', async () => {
    const signer = new Hs256TokenSigner(B, 'short'); // previous < 32 chars -> ignored
    const token = await sign(new Hs256TokenSigner(B));
    expect((await signer.verify(token))?.subject).toBe('u1'); // current still works
    // A token signed with a different valid secret does not verify (previous ignored).
    const other = await sign(new Hs256TokenSigner(C));
    expect(await signer.verify(other)).toBeNull();
  });
});
