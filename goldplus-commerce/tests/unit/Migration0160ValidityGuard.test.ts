import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, '../../apps/api/src/infrastructure/db/migrations/0160_jsonb_string_repair.sql'), 'utf8');

describe('0160 only casts strings that are valid JSON', () => {
  it('every repair UPDATE is guarded by pg_input_is_valid', () => {
    const updates = src.split('--> statement-breakpoint').filter((s) => /UPDATE /.test(s));
    expect(updates.length).toBe(5);
    for (const u of updates) expect(u).toMatch(/pg_input_is_valid\(\w+ #>> '\{\}', 'jsonb'\)/);
  });
});
