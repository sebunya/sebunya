import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AnswerProductQuestionUseCase, AskProductQuestionUseCase, QUESTIONS_PER_VISITOR_PER_DAY, normalisePhone, type IProductQuestionRepository, type ProductQuestionRow } from '../../apps/api/src/application/use-cases/questions/ProductQuestionUseCases';
import { CUSTOMER_TRANSACTIONAL_TEMPLATES, emailCopy, smsText } from '../../apps/api/src/application/notifications/CustomerMessages';

/**
 * Questions and answers on product pages (0208, gap analysis #14): the ask is validated and saved, opens a
 * follow-up on the Care Desk and acknowledges a left contact; a visitor gets a few a day; the answer is
 * published once and sent once to the asker; the messages exist on SMS and email and carry the answer.
 */
const P1 = '11111111-1111-4111-8111-111111111111';
const Q1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fakeRepo() {
  const rows: ProductQuestionRow[] = [];
  const notified: string[] = [];
  const repo: IProductQuestionRepository = {
    async productExists(id) { return id === P1 ? { name: 'Battery BL-49FT', slug: 'battery-bl-49ft' } : null; },
    async countAskedSince(hash) { return rows.filter((r) => (r as any).hash === hash).length; },
    async insert(i) { const id = `${Q1.slice(0, -1)}${rows.length}`; rows.push({ id, productId: i.productId, askerName: i.askerName, askerPhone: i.askerPhone, askerEmail: i.askerEmail, question: i.question, status: 'pending', answer: null, answeredAt: null, createdAt: new Date(), productName: 'Battery BL-49FT', productSlug: 'battery-bl-49ft', ...({ hash: i.askerIdentityHash } as object) }); return { id }; },
    async listAnswered(productId) { return rows.filter((r) => r.productId === productId && r.status === 'answered').map((r) => ({ id: r.id, askerName: r.askerName, question: r.question, answer: r.answer!, answeredAt: r.answeredAt!.toISOString() })); },
    async listByStatus(status) { return rows.filter((r) => r.status === status); },
    async countByStatus() { return { pending: rows.filter((r) => r.status === 'pending').length, answered: rows.filter((r) => r.status === 'answered').length, rejected: rows.filter((r) => r.status === 'rejected').length }; },
    async byId(id) { return rows.find((r) => r.id === id) ?? null; },
    async answer(i) { const r = rows.find((x) => x.id === i.id && x.status !== 'answered'); if (!r) return false; r.status = 'answered'; r.answer = i.answer; r.answeredAt = i.now; return true; },
    async reject(id) { const r = rows.find((x) => x.id === id); if (!r) return false; r.status = 'rejected'; return true; },
    async markNotified(id) { notified.push(id); },
  };
  return { repo, rows, notified };
}

describe('ask a question on a product page', () => {
  it('saves the question, opens a Care Desk follow-up with the asker and the answer route, and acknowledges a left phone', async () => {
    const { repo, rows } = fakeRepo();
    const tasks: any[] = []; const acks: any[] = [];
    const ask = new AskProductQuestionUseCase(repo, { openTask: async (t) => { tasks.push(t); return { ok: true, created: true }; } }, async (a) => { acks.push(a); });
    const r = await ask.execute({ productId: P1, askerIdentityHash: 'v1', name: ' Amina  Nakato ', question: 'Does it fit the Tecno Spark 10?', phone: '0772 123 456' });
    expect(r).toMatchObject({ ok: true, productName: 'Battery BL-49FT', productSlug: 'battery-bl-49ft' });
    expect(rows[0]).toMatchObject({ askerName: 'Amina Nakato', askerPhone: '+256772123456', askerEmail: null, question: 'Does it fit the Tecno Spark 10?', status: 'pending' });
    expect(tasks[0]).toMatchObject({ kind: 'follow_up', title: 'Question about Battery BL-49FT', customerPhone: '+256772123456', openedBy: 'product-question-form', proposedAction: { type: 'answer_question', productSlug: 'battery-bl-49ft' } });
    expect(tasks[0].detail).toContain('Amina Nakato asks: Does it fit the Tecno Spark 10?');
    expect(tasks[0].detail).toContain('/admin/platform-modules?question_status=pending');
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ phone: '+256772123456', email: null, productName: 'Battery BL-49FT' });
  });

  it('no contact: saved and on the desk, nothing acknowledged; a bad phone or email is refused rather than silently dropped', async () => {
    const { repo, rows } = fakeRepo();
    const acks: any[] = [];
    const ask = new AskProductQuestionUseCase(repo, { openTask: async () => ({ ok: true }) }, async (a) => { acks.push(a); });
    expect(await ask.execute({ productId: P1, askerIdentityHash: 'v1', name: 'Ali', question: 'How long does it last on a full charge?' })).toMatchObject({ ok: true });
    expect(rows).toHaveLength(1); expect(acks).toHaveLength(0);
    expect(await ask.execute({ productId: P1, askerIdentityHash: 'v1', name: 'Ali', question: 'How long does it last on a full charge?', phone: '12345' })).toEqual({ ok: false, reason: 'BAD_CONTACT' });
    expect(await ask.execute({ productId: P1, askerIdentityHash: 'v1', name: 'Ali', question: 'How long does it last on a full charge?', email: 'not-an-email' })).toEqual({ ok: false, reason: 'BAD_CONTACT' });
    expect(await ask.execute({ productId: P1, askerIdentityHash: 'v1', name: 'Ali', question: 'How long does it last?', email: 'ALI@Example.com' })).toMatchObject({ ok: true });
    expect(rows[1].askerEmail).toBe('ali@example.com');
  });

  it('refuses what it should: unknown product, no name, a question too short or too long, and more than a few a day per visitor', async () => {
    const { repo } = fakeRepo();
    const ask = new AskProductQuestionUseCase(repo, { openTask: async () => ({ ok: true }) }, async () => undefined);
    const good = { productId: P1, askerIdentityHash: 'v1', name: 'Ali', question: 'Is this the original one?' };
    expect(await ask.execute({ ...good, productId: '22222222-2222-4222-8222-222222222222' })).toEqual({ ok: false, reason: 'NO_PRODUCT' });
    expect(await ask.execute({ ...good, productId: 'nope' })).toEqual({ ok: false, reason: 'NO_PRODUCT' });
    expect(await ask.execute({ ...good, name: '' })).toEqual({ ok: false, reason: 'NO_NAME' });
    expect(await ask.execute({ ...good, question: 'hi' })).toEqual({ ok: false, reason: 'TOO_SHORT' });
    expect(await ask.execute({ ...good, question: 'x'.repeat(501) })).toEqual({ ok: false, reason: 'TOO_LONG' });
    for (let i = 0; i < QUESTIONS_PER_VISITOR_PER_DAY; i++) expect(await ask.execute(good)).toMatchObject({ ok: true });
    expect(await ask.execute(good)).toEqual({ ok: false, reason: 'TOO_MANY' });
    expect(await ask.execute({ ...good, askerIdentityHash: 'v2' })).toMatchObject({ ok: true });
  });

  it('phones are normalised to +256 and other shapes are refused', () => {
    expect(normalisePhone('0772 123 456')).toBe('+256772123456');
    expect(normalisePhone('256312000111')).toBe('+256312000111');
    expect(normalisePhone('+254712345678')).toBe('+254712345678');
    expect(normalisePhone('0112345678')).toBeNull();
    expect(normalisePhone('')).toBeNull();
  });
});

describe('answer a question', () => {
  it('publishes once, sends the answer once to the asker, and never twice; reject hides without sending', async () => {
    const { repo, rows, notified } = fakeRepo();
    const sent: any[] = [];
    const ask = new AskProductQuestionUseCase(repo, { openTask: async () => ({ ok: true }) }, async () => undefined);
    await ask.execute({ productId: P1, askerIdentityHash: 'v1', name: 'Amina', question: 'Does it fit the Tecno Spark 10?', phone: '0772123456' });
    await ask.execute({ productId: P1, askerIdentityHash: 'v2', name: 'Ali', question: 'Is it the original one from Tecno?' });
    const answer = new AnswerProductQuestionUseCase(repo, async (q) => { sent.push(q); return 'sent'; });
    expect(await answer.execute({ id: rows[0].id, answer: '   ', answeredBy: 'staff-1' })).toEqual({ ok: false, reason: 'BAD_ANSWER' });
    expect(await answer.execute({ id: rows[0].id, answer: 'Yes, it fits the Spark 10 (BL-49FT). In stock.', answeredBy: 'staff-1' })).toEqual({ ok: true, notified: true, productId: P1 });
    expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ askerPhone: '+256772123456', answer: 'Yes, it fits the Spark 10 (BL-49FT). In stock.', productSlug: 'battery-bl-49ft' });
    expect(notified).toEqual([rows[0].id]);
    expect(await answer.execute({ id: rows[0].id, answer: 'Again', answeredBy: 'staff-1' })).toEqual({ ok: false, reason: 'ALREADY' });
    expect(await answer.execute({ id: rows[1].id, answer: 'Yes, original.', answeredBy: 'staff-1' })).toEqual({ ok: true, notified: false, productId: P1 });
    expect(sent).toHaveLength(1);
    expect(await repo.listAnswered(P1, 20)).toHaveLength(2);
    expect(await answer.execute({ id: 'nope', answer: 'x'.repeat(10), answeredBy: 's' })).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(await answer.reject(rows[1].id, 'staff-1')).toBe(true);
    expect(await repo.listAnswered(P1, 20)).toHaveLength(1);
  });

  it('the two customer messages exist on SMS and email, are transactional, and the answer travels in the message', () => {
    const d = { customerName: 'Amina', productName: 'Battery BL-49FT', productUrl: 'https://www.shopgoldplus.com/products/battery-bl-49ft#questions', questionAnswer: 'Yes, it fits the Spark 10.' };
    expect(smsText('PRODUCT_QUESTION_RECEIVED', d)).toContain('your question about Battery BL-49FT');
    expect(smsText('PRODUCT_QUESTION_ANSWERED', d)).toContain('Our answer: Yes, it fits the Spark 10.');
    expect(emailCopy('PRODUCT_QUESTION_ANSWERED', d)?.body).toContain('Yes, it fits the Spark 10.');
    expect(emailCopy('PRODUCT_QUESTION_ANSWERED', d)?.cta).toEqual({ label: 'See the product', url: d.productUrl });
    expect(CUSTOMER_TRANSACTIONAL_TEMPLATES).toContain('PRODUCT_QUESTION_ANSWERED');
    expect(CUSTOMER_TRANSACTIONAL_TEMPLATES).toContain('PRODUCT_QUESTION_RECEIVED');
  });
});

describe('migration 0208', () => {
  const dir = path.resolve(__dirname, '../../apps/api/src/infrastructure/db/migrations');
  it('is journalled right after 0207 and is additive only', () => {
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string; when: number }> };
    const i = journal.entries.findIndex((e) => e.tag === '0208_product_questions');
    expect(journal.entries[i - 1].tag).toBe('0207_clarity_insights');
    expect(journal.entries[i].idx).toBe(207);
    const sql = fs.readFileSync(path.join(dir, '0208_product_questions.sql'), 'utf8');
    for (const st of sql.split('--> statement-breakpoint').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) expect(st).toMatch(/^CREATE (TABLE|INDEX) IF NOT EXISTS/);
  });
});
