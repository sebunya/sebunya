import { describe, expect, test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * P0-2 architecture guards for the canonical order-transition ledger.
 *
 *  1. The lifecycle `status` of an EXISTING order may be changed only by
 *     OrderTransitionService — the ONE canonical path that records an
 *     order_event in the same transaction. Any other `.update(orders).set({...
 *     status ...})` is a bypass that would move an order without a ledger entry.
 *     (Order CREATION — insert / upsert-on-create — sets the initial status and
 *     is out of scope; it is not a transition.)
 *
 *  2. The order_events ledger is APPEND-ONLY: no UPDATE or DELETE against it
 *     anywhere in application/infrastructure code. History is written once by the
 *     canonical service and thereafter only read.
 */

const apiSrc = path.join(__dirname, '../../apps/api/src');

function readAllTsFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) {
      // Migrations are DDL, not application writers; they legitimately create the
      // table and backfill it once.
      if (path.basename(p) === 'migrations') continue;
      readAllTsFiles(p, out);
    } else if (p.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

const CANONICAL_WRITER = path.join(apiSrc, 'infrastructure/orders/OrderTransitionService.ts');
// Creation-only persistence: sets the initial status on INSERT / upsert-on-create.
const CREATION_ALLOWLIST = [
  path.join(apiSrc, 'infrastructure/db/repositories/DrizzleOrderRepository.ts'),
];

const files = readAllTsFiles(apiSrc);

describe('P0-2 canonical order-transition guards', () => {
  test('the guarded source tree was found', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(fs.existsSync(CANONICAL_WRITER)).toBe(true);
  });

  test('only OrderTransitionService may write orders.status via update()', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file === CANONICAL_WRITER || CREATION_ALLOWLIST.includes(file)) continue;
      const content = fs.readFileSync(file, 'utf-8');
      // Find each `.update(orders)` call and inspect the `.set({...})` that
      // follows it for a lowercase `status:` key (paymentStatus:, with its capital
      // S, and reservationState do not match).
      const regex = /\.update\(\s*orders\s*\)([\s\S]{0,400})/g;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(content)) !== null) {
        const block = m[1];
        if (/\bstatus\s*:/.test(block)) {
          offenders.push(path.relative(apiSrc, file));
        }
      }
    }
    expect(offenders, `orders.status written outside the canonical service in: ${offenders.join(', ')}`).toEqual([]);
  });

  test('the order_events ledger is append-only (no update/delete)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      if (/\.update\(\s*orderEvents\s*\)/.test(content)) offenders.push(`${path.relative(apiSrc, file)} (update)`);
      if (/\.delete\(\s*orderEvents\s*\)/.test(content)) offenders.push(`${path.relative(apiSrc, file)} (delete)`);
      // Raw SQL forms.
      if (/update\s+order_events\b/i.test(content)) offenders.push(`${path.relative(apiSrc, file)} (raw update)`);
      if (/delete\s+from\s+order_events\b/i.test(content)) offenders.push(`${path.relative(apiSrc, file)} (raw delete)`);
    }
    expect(offenders, `order_events mutated (must be append-only) in: ${offenders.join(', ')}`).toEqual([]);
  });
});
