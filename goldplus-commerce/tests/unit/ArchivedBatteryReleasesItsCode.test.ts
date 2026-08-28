import { describe, expect, it } from 'vitest';
import { BatteryCatalogueUseCases } from '../../apps/api/src/application/use-cases/batteries/BatteryCatalogueUseCases';

/**
 * Archiving a battery must release its code, and restoring it must re-claim it.
 *
 * WHAT WAS WRONG
 * `aliasOwners` treats an archived battery as owning nothing: every query
 * carries `lifecycle_status <> 'ARCHIVED'`. But the database's uniqueness rule
 * is the partial index battery_aliases_active_idx, which is on `is_active`
 * alone and knows nothing about lifecycle. Archiving never touched the alias
 * rows.
 *
 * So the two disagreed. After archiving a battery (or rolling back an import,
 * which archives), re-creating the same code passed the use case's own check and
 * then violated the index: Quick Add returned a raw 500, and every row of a
 * re-import was marked FAILED carrying constraint text. With no battery data
 * imported yet, this was waiting for the first real import.
 *
 * The mirror case is restoring a battery whose code another battery has taken
 * in the meantime, which would trip the same index from the other side.
 */

interface Alias {
  id: string;
  aliasNormalised: string;
  isActive: boolean;
}

function build(opts: {
  lifecycle: string;
  aliases: Alias[];
  ownedByOther?: string | null;
}) {
  const setActive: Array<{ id: string; active: boolean }> = [];
  const profile = {
    lifecycleStatus: opts.lifecycle,
    canonicalCode: 'BL-49FT',
    canonicalCodeNormalised: 'BL49FT',
  };

  const repo = {
    findByProductId: async () => ({ profile }),
    aliasesFor: async () => opts.aliases,
    aliasOwners: async () =>
      opts.ownedByOther
        ? [{ aliasNormalised: opts.ownedByOther, productId: 'other-battery', canonicalCode: 'BL-49FT' }]
        : [],
    updateProfile: async () => undefined,
    setProductPublication: async () => undefined,
    setAliasActive: async (id: string, active: boolean) => {
      setActive.push({ id, active });
    },
  };

  const useCase = new BatteryCatalogueUseCases(
    repo as never,
    {} as never, // compatibility repo, unused on this path
    {} as never, // inventory ledger, unused on this path
    {} as never, // media use case, unused on this path
    {} as never, // media repo, unused on this path
    { save: async () => undefined } as never, // audit repo
  );
  return { useCase, setActive };
}

describe('archiving releases the code', () => {
  it('deactivates every active alias', async () => {
    const { useCase, setActive } = build({
      lifecycle: 'ACTIVE',
      aliases: [
        { id: 'a1', aliasNormalised: 'BL49FT', isActive: true },
        { id: 'a2', aliasNormalised: 'BL49FTX', isActive: true },
      ],
    });

    await useCase.transition('p1', 'ARCHIVE', 'actor', 'no longer stocked');

    expect(setActive).toEqual([
      { id: 'a1', active: false },
      { id: 'a2', active: false },
    ]);
  });

  it('leaves an already inactive alias alone', async () => {
    const { useCase, setActive } = build({
      lifecycle: 'ACTIVE',
      aliases: [{ id: 'a1', aliasNormalised: 'BL49FT', isActive: false }],
    });
    await useCase.transition('p1', 'ARCHIVE', 'actor', 'r');
    expect(setActive).toEqual([]);
  });
});

describe('restoring re-claims the code, or refuses', () => {
  it('reactivates the aliases when the code is still free', async () => {
    const { useCase, setActive } = build({
      lifecycle: 'ARCHIVED',
      aliases: [{ id: 'a1', aliasNormalised: 'BL49FT', isActive: false }],
      ownedByOther: null,
    });

    await useCase.transition('p1', 'RESTORE', 'actor', 'back in stock');

    expect(setActive).toEqual([{ id: 'a1', active: true }]);
  });

  it('refuses when another battery has taken the code, rather than tripping the index', async () => {
    const { useCase, setActive } = build({
      lifecycle: 'ARCHIVED',
      aliases: [{ id: 'a1', aliasNormalised: 'BL49FT', isActive: false }],
      ownedByOther: 'BL49FT',
    });

    await expect(useCase.transition('p1', 'RESTORE', 'actor', 'back')).rejects.toThrow();
    // Nothing was reactivated on the refused path.
    expect(setActive).toEqual([]);
  });
});
