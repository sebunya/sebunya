import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = readFileSync(path.resolve(__dirname, '../../apps/api/src/scripts/cancel-orders.ts'), 'utf8');

describe('scripts/cancel-orders.ts (review 212)', () => {
  it("uses the Registry's transition service, so the cancellation subscribers run", () => {
    expect(src).toMatch(/registry\.orderTransitionService/);
    expect(src).not.toMatch(/new OrderTransitionService\(/);
  });
  it('never releases stock itself, and skips an order whose goods have left the shop', () => {
    expect(src).not.toMatch(/releaseInventory|ReleaseInventoryForOrderUseCase/);
    expect(src).toMatch(/GOODS_LEFT_STATUSES\.has\(order\.orderStatus\)[\s\S]{0,200}continue;/);
    expect(src.indexOf('GOODS_LEFT_STATUSES.has')).toBeLessThan(src.indexOf('transitions.transition('));
  });
});
