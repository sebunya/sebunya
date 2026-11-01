import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AnswerProductQuestionUseCase, AskProductQuestionUseCase, QUESTIONS_PER_SHOP_PER_DAY, QUESTIONS_PER_VISITOR_PER_DAY, normalisePhone, type IProductQuestionRepository, type ProductQuestionRow } from '../../apps/api/src/application/use-cases/questions/ProductQuestionUseCases';
import { classifyPublicEndpoint } from '../../apps/api/src/domain/security/PublicEndpointPolicy';
import { PUBLIC_FORM_BUDGETS } from '../../apps/web/src/lib/publicFormLimiter';
import { CUSTOMER_TRANSACTIONAL_TEMPLATES, emailCopy, smsText } from '../../apps/api/src/application/notifications/CustomerMessages';

/**
 * Questions and answers on product pages (0208, gap analysis #14): the ask is validated and saved, opens a
 * follow-up on the Care Desk and acknowledges a left contact; a visitor gets a few a day; the answer is
 * published once and sent once to the asker; the messages exist on SMS and email and carry the answer.
 */
const P1 = '11111111-1111-4111-8111-111111111111';
const Q1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fakeRepo(shopBefore = 0) {
  const rows: ProductQuestionRow[] = [];
  const notified: string[] = [];
  const repo: IProductQuestionRepository = {
    async productExists(id) { return id === P1 ? { name: 'Battery BL-49FT', slug: 'battery-bl-49ft' } : null; },
    async countAskedSince(hash) { return rows.filter((r) => (r as any).hash === hash).length; },
    async countAllAskedSince() { return rows.length + shopBefore; },
    async insert(i) { const id = `${Q1.slice(0, -1)}${rows.length}`; rows.push({ id, productId: i.productId, askerName: i.askerName, askerPhone: i.askerPhone, askerEmail: i.askerEmail, question: i.question, status: 'pending', answer: null, answeredAt: null, createdAt: new Date(), productName: 'Battery BL-49FT', productSlug: 'battery-bl-49ft', ...({ hash: i.askerIdentityHash } as object) }); return { id }; },
    async listAnswered(productId) { return rows.filter((r) => r.productId === productId && r.status === 'answered').map((r) => ({ id: r.id, askerName: r.askerName, question: r.question, answer: r.answer!, answeredAt: r.answeredAt!.toISOString() })); },
    async listByStatus(status) { return rows.filter((r) => r.status === status); },
    async countByStatus() { return { pending: rows.filter((r) => r.status === 'pending').length, answered: rows.filter((r) => r.status === 'answered').length, rejected: rows.filter((r) => r.status === 'rejected').length }; },
    async byId(id) { return rows.find((r) => r.id === id) ?? null; },
    async answer(i) { const r = rows.find((x) => x.id === i.id && x.status !== 'answered'); if (!r) return false; r.status = 'answered'; r.answer = i.answer; r.answeredAt = i.now; return true; },
    async reject(id) { const r = rows.find((x) => x.id === id); if (!r) return false; r.status = 'rejected'; return true; },
    async markNotified(id, now) { notified.push(id); const r = rows.find((x) => x.id === id); if (r) r.notifiedAt = now; },
    async updateAnswer(i) { const r = rows.find((x) => x.id === i.id && x.status === 'answered'); if (!r) return false; r.answer = i.answer; r.answeredAt = i.now; return true; },
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

  it('a whole-shop ceiling stops a flood from fresh visit tokens (each question can text a number)', async () => {
    const { repo } = fakeRepo(QUESTIONS_PER_SHOP_PER_DAY - 1);
    let acks = 0;
    const ask = new AskProductQuestionUseCase(repo, { openTask: async () => ({ ok: true }) }, async () => { acks += 1; });
    const q = (v: string) => ({ productId: P1, askerIdentityHash: v, name: 'Ali', question: 'Is this the original one?', phone: '0772000001' });
    expect(await ask.execute(q('fresh-1'))).toMatchObject({ ok: true });
    expect(await ask.execute(q('fresh-2'))).toEqual({ ok: false, reason: 'SHOP_BUSY' });
    expect(acks).toBe(1);
  });

  it('a number or an email typed into the name or the question is refused: those are published', async () => {
    const { repo } = fakeRepo();
    const ask = new AskProductQuestionUseCase(repo, { openTask: async () => ({ ok: true }) }, async () => undefined);
    const base = { productId: P1, askerIdentityHash: 'v9', name: 'Ali', question: 'Is this the original one?' };
    expect(await ask.execute({ ...base, question: 'Do you have it in Ntinda? Call me 0772 123 456' })).toEqual({ ok: false, reason: 'CONTACT_IN_TEXT' });
    expect(await ask.execute({ ...base, question: 'Email me at ali@example.com please' })).toEqual({ ok: false, reason: 'CONTACT_IN_TEXT' });
    expect(await ask.execute({ ...base, name: 'Ali 0772123456' })).toEqual({ ok: false, reason: 'CONTACT_IN_TEXT' });
    expect(await ask.execute({ ...base, question: 'Does the 20000mAh SM-A326B one fit?', phone: '0772 123 456' })).toMatchObject({ ok: true });
  });

  it('without JavaScript an email in the phone-or-email box reaches the API as an email, and a refusal says why', () => {
    const relay = fs.readFileSync(path.resolve(__dirname, '../../apps/web/src/pages/api/questions/ask.ts'), 'utf8');
    expect(relay).toContain("if (body.phone.includes('@') && !body.email) { body.email = body.phone.slice(0, MAX.email); body.phone = ''; }");
    expect(relay).toMatch(/phone: 254/);
    expect(relay).toContain('&why=${code}');
    const pdp = fs.readFileSync(path.resolve(__dirname, '../../apps/web/src/pages/products/[slug].astro'), 'utf8');
    expect(pdp).toContain('{askedWhy}');
    expect(pdp).not.toMatch(/name="phone"[^>]*inputmode="tel"/);
  });

  it('the route and the web relay are budgeted as human forms, not the shared global allowance', () => {
    expect(classifyPublicEndpoint('POST', '/commerce/questions')).toBe('quote-request');
    expect(classifyPublicEndpoint('POST', '/commerce/reviews/photos')).toBe('issue-report');
    expect(PUBLIC_FORM_BUDGETS['/api/questions/ask']).toEqual({ limit: 5, windowMs: 600_000 });
  });

  it('only a Ugandan mobile is taken (the answer goes by SMS, and only Ugandan mobiles receive it)', () => {
    expect(normalisePhone('0772 123 456')).toBe('+256772123456');
    expect(normalisePhone('+256 772 123456')).toBe('+256772123456');
    expect(normalisePhone('256772123456')).toBe('+256772123456');
    // a landline and a foreign mobile were accepted, never reached, and staff were told the answer was sent
    expect(normalisePhone('256312000111')).toBeNull();
    expect(normalisePhone('0312000111')).toBeNull();
    expect(normalisePhone('+254712345678')).toBeNull();
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
    expect(await answer.execute({ id: rows[0].id, answer: 'Yes, it fits the Spark 10 (BL-49FT). In stock.', answeredBy: 'staff-1' })).toEqual({ ok: true, notified: true, notice: 'queued', productId: P1 });
    expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ askerPhone: '+256772123456', answer: 'Yes, it fits the Spark 10 (BL-49FT). In stock.', productSlug: 'battery-bl-49ft' });
    expect(notified).toEqual([rows[0].id]);
    expect(await answer.execute({ id: rows[0].id, answer: 'Again', answeredBy: 'staff-1' })).toEqual({ ok: false, reason: 'ALREADY' });
    expect(await answer.execute({ id: rows[1].id, answer: 'Yes, original.', answeredBy: 'staff-1' })).toEqual({ ok: true, notified: false, notice: 'no_contact', productId: P1 });
    expect(sent).toHaveLength(1);
    expect(await repo.listAnswered(P1, 20)).toHaveLength(2);
    expect(await answer.execute({ id: 'nope', answer: 'x'.repeat(10), answeredBy: 's' })).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(await answer.reject(rows[1].id, 'staff-1')).toBe(true);
    expect(await repo.listAnswered(P1, 20)).toHaveLength(1);
  });

  it('a message that could not be queued says so, and can be sent again once, never twice', async () => {
    const { repo, rows } = fakeRepo();
    const ask = new AskProductQuestionUseCase(repo, { openTask: async () => ({ ok: true }) }, async () => undefined);
    await ask.execute({ productId: P1, askerIdentityHash: 'v1', name: 'Amina', question: 'Does it fit the Tecno Spark 10?', phone: '0772123456' });
    await ask.execute({ productId: P1, askerIdentityHash: 'v2', name: 'Ali', question: 'Is it the original one from Tecno?' });
    let outboxUp = false;
    const answer = new AnswerProductQuestionUseCase(repo, async () => { if (!outboxUp) throw new Error('outbox down'); return 'sent'; });
    expect(await answer.execute({ id: rows[0].id, answer: 'Yes, it fits.', answeredBy: 's' })).toMatchObject({ ok: true, notified: false, notice: 'failed' });
    outboxUp = true;
    expect(await answer.resend(rows[0].id)).toEqual({ ok: true, notice: 'queued' });
    expect(await answer.resend(rows[0].id)).toEqual({ ok: false, reason: 'ALREADY_SENT' });
    await answer.execute({ id: rows[1].id, answer: 'Yes, original.', answeredBy: 's' });
    expect(await answer.resend(rows[1].id)).toEqual({ ok: false, reason: 'NO_CONTACT' });
  });

  it('a published answer can be corrected (not sent again) and hidden; a pending one cannot be corrected', async () => {
    const { repo, rows } = fakeRepo();
    const sent: unknown[] = [];
    const ask = new AskProductQuestionUseCase(repo, { openTask: async () => ({ ok: true }) }, async () => undefined);
    await ask.execute({ productId: P1, askerIdentityHash: 'v1', name: 'Amina', question: 'Does it fit the Tecno Spark 10?', phone: '0772123456' });
    await ask.execute({ productId: P1, askerIdentityHash: 'v2', name: 'Ali', question: 'Is it the original one from Tecno?' });
    const answer = new AnswerProductQuestionUseCase(repo, async (q) => { sent.push(q); return 'sent'; });
    expect(await answer.edit({ id: rows[0].id, answer: 'Yes.', editedBy: 's' })).toEqual({ ok: false, reason: 'NOT_ANSWERED' });
    await answer.execute({ id: rows[0].id, answer: 'Yes, it fits. In stock at 45,000.', answeredBy: 's' });
    expect(await answer.edit({ id: rows[0].id, answer: ' ', editedBy: 's' })).toEqual({ ok: false, reason: 'BAD_ANSWER' });
    expect(await answer.edit({ id: rows[0].id, answer: 'Yes, it fits the Spark 10.', editedBy: 's' })).toEqual({ ok: true, previous: 'Yes, it fits. In stock at 45,000.' });
    expect((await repo.listAnswered(P1, 20))[0].answer).toBe('Yes, it fits the Spark 10.');
    expect(sent).toHaveLength(1); // the correction is not sent
    expect(await answer.reject(rows[0].id, 's')).toBe(true);
    expect(await repo.listAnswered(P1, 20)).toHaveLength(0);
  });

  it('staff can correct, hide and resend from the queue, the routes are audited, and agents get the answer date', () => {
    const page = fs.readFileSync(path.resolve(__dirname, '../../apps/web/src/pages/admin/platform-modules.astro'), 'utf8');
    for (const intent of ['edit_answer', 'resend_answer', 'reject_question']) expect(page).toContain(`value="${intent}"`);
    expect(page).toContain('Hide from the product page');
    expect(page).not.toMatch(/placeholder="[^"]*(in stock|UGX|\d{2},\d{3})/i); // no price or stock modelled in the example
    const routes = fs.readFileSync(path.resolve(__dirname, '../../apps/api/src/interfaces/http/routes/admin/new-modules.ts'), 'utf8');
    expect(routes).toContain("action: 'PRODUCT_QUESTION_ANSWER_EDITED'");
    expect(routes).toContain('previousState: { answer: result.previous }');
    expect(routes).toContain("action: 'PRODUCT_QUESTION_ANSWER_RESENT'");
    const tools = fs.readFileSync(path.resolve(__dirname, '../../apps/web/src/lib/agentTools.ts'), 'utf8');
    expect(tools).toContain("answeredOn: String(q.answeredAt ?? '').slice(0, 10)");
    expect(tools).toContain('for price and stock, the live figures above win');
  });

  it('answering or rejecting closes the question\'s Care Desk task, so nobody contacts the asker twice', async () => {
    const { repo, rows } = fakeRepo();
    const closed: string[] = [];
    const ask = new AskProductQuestionUseCase(repo, { openTask: async () => ({ ok: true }) }, async () => undefined);
    await ask.execute({ productId: P1, askerIdentityHash: 'v1', name: 'Amina', question: 'Does it fit the Tecno Spark 10?' });
    await ask.execute({ productId: P1, askerIdentityHash: 'v2', name: 'Ali', question: 'Is it the original one from Tecno?' });
    const answer = new AnswerProductQuestionUseCase(repo, async () => 'sent', () => new Date(), async (id, outcome) => { closed.push(`${id}:${outcome}`); });
    await answer.execute({ id: rows[0].id, answer: 'Yes, it fits.', answeredBy: 'staff-1' });
    await answer.reject(rows[1].id, 'staff-1');
    expect(closed).toEqual([`${rows[0].id}:done`, `${rows[1].id}:cancelled`]);
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
