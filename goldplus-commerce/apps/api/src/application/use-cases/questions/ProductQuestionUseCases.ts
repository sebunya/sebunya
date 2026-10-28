import type { OpenTaskInput } from '../assistant/CareDeskUseCases';
import { detectReviewPii } from '../../../domain/reviews/ReviewDomain';

/**
 * Questions and answers on product pages (0208, gap analysis #14, 2026-10-25).
 *
 * Ask: a shopper on the product page types a name, the question and, if they want the answer sent to them, a
 * phone or email. The question is saved as pending, opens a follow-up task on the Care Desk (alerted like any
 * other, so it is answered the same day), and the asker gets the usual "we have it" acknowledgement. One
 * visitor may ask a few a day; the visit token is hashed, as review votes are.
 *
 * Answer: staff answer from Admin > Platform modules. The answer is published under the product for everyone
 * and sent to the asker once (transactional: it is the reply to their own question). Reject hides a question
 * that is spam or not about the product; nothing is sent.
 */
export const QUESTIONS_PER_VISITOR_PER_DAY = 3;
/**
 * The whole shop's questions in 24 hours. Each question can text the number typed on it, and a visit token is free
 * to mint, so the per-visitor cap alone let a script send acknowledgement SMS to any number from the shop's own
 * credit (the credit that also carries sign-in codes). Far above a real day's questions; reaching it refuses new ones
 * as "too many" until the oldest ages out (2026-10-29).
 */
export const QUESTIONS_PER_SHOP_PER_DAY = 150;
export const QUESTION_MIN = 8;
export const QUESTION_MAX = 500;
export const ANSWER_MIN = 2;
export const ANSWER_MAX = 1500;

export type QuestionStatus = 'pending' | 'answered' | 'rejected';
export interface ProductQuestionRow {
  id: string; productId: string; askerName: string; askerPhone: string | null; askerEmail: string | null; question: string;
  status: QuestionStatus; answer: string | null; answeredAt: Date | null; createdAt: Date;
  productName?: string | null; productSlug?: string | null;
}
export interface PublicQuestion { id: string; askerName: string; question: string; answer: string; answeredAt: string }

export interface IProductQuestionRepository {
  productExists(productId: string): Promise<{ name: string; slug: string } | null>;
  countAskedSince(askerIdentityHash: string, since: Date): Promise<number>;
  /** Every question asked in the shop since `since` (the shop-wide ceiling). */
  countAllAskedSince(since: Date): Promise<number>;
  insert(input: { productId: string; askerIdentityHash: string; askerName: string; askerPhone: string | null; askerEmail: string | null; question: string }): Promise<{ id: string }>;
  listAnswered(productId: string, limit: number): Promise<PublicQuestion[]>;
  listByStatus(status: QuestionStatus, limit: number): Promise<ProductQuestionRow[]>;
  countByStatus(): Promise<Record<QuestionStatus, number>>;
  byId(id: string): Promise<ProductQuestionRow | null>;
  answer(input: { id: string; answer: string; answeredBy: string; now: Date }): Promise<boolean>;
  reject(id: string, by: string, now: Date): Promise<boolean>;
  markNotified(id: string, now: Date): Promise<void>;
}

export type AskResult =
  | { ok: true; id: string; productName: string; productSlug: string }
  | { ok: false; reason: 'NO_PRODUCT' | 'NO_NAME' | 'TOO_SHORT' | 'TOO_LONG' | 'BAD_CONTACT' | 'CONTACT_IN_TEXT' | 'TOO_MANY' | 'SHOP_BUSY' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** A Ugandan or international phone, kept as typed but checked for shape; empty when it is not one. */
export function normalisePhone(raw: unknown): string | null {
  const digits = clean(raw, 32).replace(/[\s().-]/g, '');
  if (!digits) return null;
  if (/^0[37]\d{8}$/.test(digits)) return `+256${digits.slice(1)}`;
  if (/^256[37]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^\+\d{9,15}$/.test(digits)) return digits;
  return null;
}

export class AskProductQuestionUseCase {
  constructor(
    private readonly repo: IProductQuestionRepository,
    private readonly care: { openTask(input: OpenTaskInput): Promise<{ ok: boolean; created?: boolean }> },
    private readonly acknowledge: (input: { id: string; name: string; phone: string | null; email: string | null; productName: string }) => Promise<unknown>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: { productId: string; askerIdentityHash: string; name: unknown; question: unknown; phone?: unknown; email?: unknown }): Promise<AskResult> {
    if (!UUID.test(input.productId)) return { ok: false, reason: 'NO_PRODUCT' };
    const name = clean(input.name, 80);
    if (name.length < 2) return { ok: false, reason: 'NO_NAME' };
    const question = clean(input.question, QUESTION_MAX + 1);
    if (question.length < QUESTION_MIN) return { ok: false, reason: 'TOO_SHORT' };
    if (question.length > QUESTION_MAX) return { ok: false, reason: 'TOO_LONG' };
    // The name and the question are published under the product once answered (and given to shopping assistants):
    // a number or an email typed into them would be published with them. Reviews hold such text for a person; a
    // question is refused with a pointer to the private contact box (2026-10-29).
    if (detectReviewPii(name, question).hasPii) return { ok: false, reason: 'CONTACT_IN_TEXT' };
    const phoneRaw = clean(input.phone, 32);
    const phone = phoneRaw ? normalisePhone(phoneRaw) : null;
    if (phoneRaw && !phone) return { ok: false, reason: 'BAD_CONTACT' };
    const emailRaw = clean(input.email, 254).toLowerCase();
    if (emailRaw && !EMAIL.test(emailRaw)) return { ok: false, reason: 'BAD_CONTACT' };
    const email = emailRaw || null;
    const product = await this.repo.productExists(input.productId);
    if (!product) return { ok: false, reason: 'NO_PRODUCT' };
    const now = this.now();
    const dayAgo = new Date(now.getTime() - 86_400_000);
    if ((await this.repo.countAskedSince(input.askerIdentityHash, dayAgo)) >= QUESTIONS_PER_VISITOR_PER_DAY) return { ok: false, reason: 'TOO_MANY' };
    if ((await this.repo.countAllAskedSince(dayAgo)) >= QUESTIONS_PER_SHOP_PER_DAY) return { ok: false, reason: 'SHOP_BUSY' };
    const { id } = await this.repo.insert({ productId: input.productId, askerIdentityHash: input.askerIdentityHash, askerName: name, askerPhone: phone, askerEmail: email, question });
    // The desk sees it like any other follow-up; a failure to open the task never loses the question (it is saved).
    await this.care.openTask({
      kind: 'follow_up',
      title: `Question about ${product.name}`.slice(0, 200),
      detail: [`${name} asks: ${question}`, phone || email ? `Answer goes to: ${[phone, email].filter(Boolean).join(', ')}` : 'No contact left: the answer is published on the product page only.', `Answer it: /admin/platform-modules?question_status=pending`].join('\n'),
      customerName: name,
      customerPhone: phone,
      customerEmail: email,
      channel: 'web',
      proposedAction: { type: 'answer_question', questionId: id, productId: input.productId, productSlug: product.slug },
      openedBy: 'product-question-form',
    }).catch(() => undefined);
    if (phone || email) await this.acknowledge({ id, name, phone, email, productName: product.name }).catch(() => undefined);
    return { ok: true, id, productName: product.name, productSlug: product.slug };
  }
}

export type AnswerResult = { ok: true; notified: boolean; productId: string } | { ok: false; reason: 'NOT_FOUND' | 'BAD_ANSWER' | 'ALREADY' };

export class AnswerProductQuestionUseCase {
  constructor(
    private readonly repo: IProductQuestionRepository,
    private readonly notify: (q: ProductQuestionRow & { answer: string }) => Promise<'sent' | 'skipped'>,
    private readonly now: () => Date = () => new Date(),
    /** Closes the question's Care Desk follow-up (opened when it was asked), so nobody contacts the asker twice. */
    private readonly closeDeskTask: (questionId: string, outcome: 'done' | 'cancelled', by: string) => Promise<unknown> = async () => undefined,
  ) {}

  async execute(input: { id: string; answer: unknown; answeredBy: string }): Promise<AnswerResult> {
    if (!UUID.test(input.id)) return { ok: false, reason: 'NOT_FOUND' };
    const answer = typeof input.answer === 'string' ? input.answer.replace(/\r\n/g, '\n').trim() : '';
    if (answer.length < ANSWER_MIN || answer.length > ANSWER_MAX) return { ok: false, reason: 'BAD_ANSWER' };
    const q = await this.repo.byId(input.id);
    if (!q) return { ok: false, reason: 'NOT_FOUND' };
    if (q.status === 'answered') return { ok: false, reason: 'ALREADY' };
    const now = this.now();
    if (!(await this.repo.answer({ id: q.id, answer, answeredBy: input.answeredBy, now }))) return { ok: false, reason: 'NOT_FOUND' };
    let notified = false;
    if (q.askerPhone || q.askerEmail) {
      const r = await this.notify({ ...q, answer, status: 'answered', answeredAt: now }).catch(() => 'skipped' as const);
      notified = r === 'sent';
      if (notified) await this.repo.markNotified(q.id, now).catch(() => undefined);
    }
    await this.closeDeskTask(q.id, 'done', input.answeredBy).catch(() => undefined);
    return { ok: true, notified, productId: q.productId };
  }

  async reject(id: string, by: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const done = await this.repo.reject(id, by, this.now());
    if (done) await this.closeDeskTask(id, 'cancelled', by).catch(() => undefined);
    return done;
  }
}
