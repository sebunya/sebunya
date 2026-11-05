import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';

/**
 * N6: the public Q&A read (the source of the PDP list and the MCP get_product
 * answers) exposes ONLY answered questions and ONLY public fields. Pending and
 * rejected questions, the asker's phone and email, the identity hash and the
 * answering staff id never leave it. Synthetic fixtures; real PostgreSQL.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

d('public product questions boundary (real PostgreSQL)', () => {
  let raw: any; let repo: any; let productId = ''; let catId = '';
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 2, prepare: false });
    catId = (await raw`insert into categories (name, slug) values ('T', ${'t-qa-' + tag}) returning id`)[0].id;
    const sku = `QA-${tag}`.toUpperCase();
    productId = (await raw`insert into products (sku, model_number, name, slug, category_id, price_ugx, active, approval_status) values (${sku}, ${sku}, 'QA Test', ${sku.toLowerCase()}, ${catId}, 10000, true, 'approved') returning id`)[0].id;
    const row = (status: string, q: string, answer: string | null, name = 'Test Asker') =>
      raw`insert into product_questions (product_id, asker_identity_hash, asker_name, asker_phone, asker_email, question, status, answer, answered_at)
          values (${productId}, ${'h'.repeat(64)}, ${name}, '+256700000000', 'asker@example.test', ${q}, ${status}, ${answer}, ${answer ? new Date() : null})`;
    await row('answered', 'Does it fit "model & co" – ünïcode?', 'Yes.\nIt fits.');
    await row('pending', 'PENDING-QUESTION-TEXT', null);
    await row('rejected', 'REJECTED-QUESTION-TEXT', 'MODERATION-NOTE-TEXT');
    await row('answered', 'Erased asker question?', 'Answer.', "Removed at the customer's request");
    const { DrizzleProductQuestionRepository } = await import('../../apps/api/src/infrastructure/questions/DrizzleProductQuestionRepository');
    repo = new DrizzleProductQuestionRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from product_questions where product_id = ${productId}`;
    await raw`delete from products where id = ${productId}`;
    await raw`delete from categories where id = ${catId}`;
    await raw.end();
  });

  it('only answered questions, only public fields, text intact', async () => {
    const list = await repo.listAnswered(productId, 20);
    expect(list).toHaveLength(2);
    for (const q of list) expect(Object.keys(q).sort()).toEqual(['answer', 'answeredAt', 'askerName', 'id', 'question']);
    const blob = JSON.stringify(list);
    for (const secret of ['PENDING-QUESTION-TEXT', 'REJECTED-QUESTION-TEXT', 'MODERATION-NOTE-TEXT', '+256700000000', 'asker@example.test', 'h'.repeat(64)]) expect(blob).not.toContain(secret);
    const fit = list.find((q: any) => q.question.startsWith('Does it fit'));
    expect(fit.question).toBe('Does it fit "model & co" – ünïcode?');
    expect(fit.answer).toBe('Yes.\nIt fits.');
    expect(list.find((q: any) => q.question.startsWith('Erased')).askerName).toBe('a customer');
  });
});
