import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('backordered orders are visible to admins', () => {
  const routes = read('apps/api/src/interfaces/http/routes/governance.ts');
  const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleOrderRepository.ts');

  it('reads reservation_state for the admin list and detail responses', () => {
    expect(repo).toMatch(/async findAdminFacts\(ids: string\[\]\)/);
    expect(repo).toMatch(/reservationState: orders\.reservationState/);
    const list = routes.slice(routes.indexOf("routes.get('/admin/orders',"), routes.indexOf("routes.get('/admin/orders/:id',"));
    expect(list).toMatch(/findAdminFacts\(ordersList\.map/);
    expect(list).toMatch(/c\.req\.query\('reservation'\)/);
    const detail = routes.slice(routes.indexOf("routes.get('/admin/orders/:id',"), routes.indexOf("routes.get('/admin/carts/:id'"));
    expect(detail).toMatch(/findAdminFacts\(\[order\.id\]\)/);
    expect(routes).toMatch(/isBackordered: reservationState === 'BACKORDERED'/);
  });

  it('shows a Backordered badge on the list and detail pages, with a list filter', () => {
    const list = read('apps/web/src/pages/admin/orders/index.astro');
    const detail = read('apps/web/src/pages/admin/orders/[id].astro');
    expect(list).toMatch(/order\.reservationState === 'BACKORDERED'/);
    expect(list).toMatch(/href="\/admin\/orders\?reservation=backordered"/);
    expect(list).toMatch(/queryParams\.set\('reservation', reservationFilter\)/);
    expect(detail).toMatch(/order\.reservationState === 'BACKORDERED'/);
    expect(detail).toContain('>Backordered</span>');
  });
});
