import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  isKnownInvalidHistoricalStatement,
  KNOWN_INVALID_0018_STATEMENTS,
} from '../../apps/api/src/infrastructure/db/migrations/knownInvalidHistoricalStatements';

const root = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(root, f), 'utf8');

describe('Slice 14C migration-history integrity', () => {
  it('keeps historical migration 0018 byte-identical to its original commit', () => {
    const bytes = read('apps/api/src/infrastructure/db/migrations/0018_real_prism.sql');
    const sha = createHash('sha256').update(bytes).digest('hex');
    // Original committed content (git show 1a45f9b / 4bdd642^).
    expect(sha).toBe('69acb44c10ab115cc527cb0aa9fab7c1844e740ab8418d235669ab812f9bba46');
  });

  it('recognises exactly the four dead 0018 FK statements', () => {
    expect(KNOWN_INVALID_0018_STATEMENTS).toHaveLength(4);
    for (const stmt of KNOWN_INVALID_0018_STATEMENTS) {
      expect(isKnownInvalidHistoricalStatement(stmt)).toBe(true);
      expect(isKnownInvalidHistoricalStatement(`  ${stmt.replace(/\n/g, '  ')}  `)).toBe(true); // whitespace-insensitive
    }
    const migration0018 = read('apps/api/src/infrastructure/db/migrations/0018_real_prism.sql');
    for (const stmt of KNOWN_INVALID_0018_STATEMENTS) {
      expect(migration0018).toContain(stmt.split('\n')[1].trim()); // each ALTER really exists in 0018
    }
  });

  it('never matches the 0028 repair statements or anything else (no generic suppression)', () => {
    const repair = read(
      require('node:fs')
        .readdirSync(resolve(root, 'apps/api/src/infrastructure/db/migrations'))
        .filter((f: string) => f.startsWith('0028_'))
        .map((f: string) => `apps/api/src/infrastructure/db/migrations/${f}`)[0]
    );
    for (const block of repair.split('--> statement-breakpoint')) {
      expect(isKnownInvalidHistoricalStatement(block), 'a 0028 repair statement must never be skipped').toBe(false);
    }
    expect(isKnownInvalidHistoricalStatement('ALTER TABLE "users" DROP COLUMN "email";')).toBe(false);
    expect(isKnownInvalidHistoricalStatement('DO $$ BEGIN SELECT 1; EXCEPTION WHEN others THEN null; END $$;')).toBe(false);
    // A near-miss (different constraint name) must not match either.
    const nearMiss = KNOWN_INVALID_0018_STATEMENTS[0].replace('release_decisions_recorded_by_users_id_fk', 'release_decisions_other_fk');
    expect(isKnownInvalidHistoricalStatement(nearMiss)).toBe(false);
  });
});
