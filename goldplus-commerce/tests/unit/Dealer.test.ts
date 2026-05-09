import { expect, test, describe } from 'vitest';
import { Dealer } from '../../apps/api/src/domain/dealers/Dealer';
import { InventoryAudit } from '../../apps/api/src/domain/dealers/InventoryAudit';

describe('Dealer Domain Entity', () => {
  test('Should start in pending status', () => {
    const dealer = Dealer.apply('d1', 'Store', 'John', 'j@e.com', '1', 'TIN', 'Kla');
    expect(dealer.status).toBe('pending');
    expect(dealer.approvedAt).toBeUndefined();
  });

  test('Should transition to approved', () => {
    const dealer = Dealer.apply('d1', 'Store', 'John', 'j@e.com', '1', 'TIN', 'Kla');
    const approvedDealer = dealer.approve();
    expect(approvedDealer.status).toBe('approved');
    expect(approvedDealer.approvedAt).toBeDefined();
  });
});

describe('InventoryAudit Domain Entity', () => {
  test('Should calculate new quantity correctly', () => {
    const audit = InventoryAudit.log('a1', 'p1', 'admin', 10, 5, 'Stock up');
    expect(audit.previousQuantity).toBe(5);
    expect(audit.newQuantity).toBe(15);
  });
});
