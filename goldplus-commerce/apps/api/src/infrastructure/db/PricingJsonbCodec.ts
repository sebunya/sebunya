import { SQL, sql } from 'drizzle-orm';
import { client } from './client';

export function encodePricingJsonb(value: Record<string, unknown> | unknown[]): SQL {
  JSON.stringify(value);
  return sql`${client.json(value as any)}::jsonb`;
}

export function decodePricingJsonb<T extends Record<string, unknown> | unknown[]>(value: unknown): T {
  const decoded = typeof value === 'string' ? JSON.parse(value) : value;
  if (decoded === null || typeof decoded !== 'object') throw new Error('MALFORMED_PRICING_JSONB');
  return decoded as T;
}
