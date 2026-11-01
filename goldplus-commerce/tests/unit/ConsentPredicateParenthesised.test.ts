import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { and, eq, sql } from 'drizzle-orm';
import { consentCurrentState } from '../../apps/api/src/infrastructure/db/schema';

/**
 * drizzle's and() does not parenthesise a raw sql`` fragment, so
 * `a and b and x is null or y > now()` matched ANY visitor's unexpired
 * consent row: a customer who never granted personalisation was shown
 * surveys and interventions with a stranger's consent record as evidence.
 */
const ROOT = resolve(__dirname, '../../apps/api/src/infrastructure/db/repositories');

describe('a raw OR inside and() is parenthesised', () => {
  it('the survey and intervention consent gates bind the OR to the user', () => {
    const dialect = new PgDialect();
    const where = and(
      eq(consentCurrentState.userId, '00000000-0000-4000-8000-000000000001'),
      eq(consentCurrentState.personalizationGranted, true),
      sql`(${consentCurrentState.expiresAt} is null or ${consentCurrentState.expiresAt} > now())`,
    )!;
    expect(dialect.sqlToQuery(where).sql).toMatch(/and \("consent_current_state"\."expires_at" is null or "consent_current_state"\."expires_at" > now\(\)\)\)$/);
    for (const file of ['DrizzleSurveyRepository.ts', 'DrizzleBehaviouralInterventionRepository.ts']) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src, file).toContain('sql`(${consentCurrentState.expiresAt} is null or ${consentCurrentState.expiresAt} > now())`');
    }
  });

  it('no repository passes an unparenthesised "x is null or" fragment', () => {
    for (const file of readdirSync(ROOT).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src, file).not.toMatch(/sql`\$\{[^}]+\} is null or /);
    }
  });
});
