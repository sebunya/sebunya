import { META_GRAPH_VERSION } from '../../advertising/AdPlatforms';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { notificationAttempts } from '../../db/schema/phase11';
import { readMetaWhatsAppConfig } from '../../../config/metaWhatsApp';
import { CARE_ALERT_TEMPLATE, WHATSAPP_TEMPLATES, careAlertCreateBody, metaTemplateCreateBody } from './whatsAppTemplates';

export interface MetaTemplateState { id: string | null; name: string; status: string; category: string | null; language: string | null; rejectedReason: string | null; bodyText: string | null }
export interface TemplateRow { ours: string; name: string; category: string; status: string; rejectedReason: string | null }

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const FRESH_MS = 10 * 60_000;
/** After a failed listing, wait this long before asking Meta again (every routing check would otherwise re-list). */
const RETRY_MS = 60_000;
/** A reading older than this is not trusted to say "approved" (Meta may have paused or removed the template). */
const STALE_MS = 6 * 3600_000;
const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
/** The category the template must keep: utility (or authentication) messages may go to every customer; marketing may not. */
function expectedCategory(name: string): string | null {
  if (name === CARE_ALERT_TEMPLATE.name) return CARE_ALERT_TEMPLATE.category;
  return Object.values(WHATSAPP_TEMPLATES).find((t) => t.name === name)?.category ?? null;
}
/** The words Meta should hold for a template name (null for authentication: Meta writes those). */
function expectedBody(name: string): string | null {
  if (name === CARE_ALERT_TEMPLATE.name) return CARE_ALERT_TEMPLATE.body;
  const spec = Object.values(WHATSAPP_TEMPLATES).find((t) => t.name === name);
  return spec && spec.category !== 'AUTHENTICATION' ? spec.body : null;
}

/**
 * What Meta says about our templates: approved, pending, rejected, paused. A template is sent only when Meta
 * says APPROVED. Read from Meta at most every 10 minutes (refreshed in the background, never in a send's way),
 * and on demand from the admin page. Also submits the templates Meta does not have yet.
 */
export class MetaWhatsAppTemplateCatalog {
  private states = new Map<string, MetaTemplateState>();
  private readAt = 0;
  private retryAt = 0;
  private inflight: Promise<void> | null = null;
  lastError: string | null = null;

  constructor(private readonly account: () => Promise<{ wabaId: string; accessToken: string | null } | null>, private readonly fetchImpl: typeof fetch = fetch, private readonly now: () => number = () => Date.now()) {}

  /** The server setting wins; otherwise the WhatsApp account and token saved in the admin. */
  async credentials(): Promise<{ wabaId: string | null; token: string | null; candidates: string[] }> {
    const cfg = readMetaWhatsAppConfig();
    const saved = cfg.wabaId && cfg.envToken ? null : await this.account().catch(() => null);
    const waba = cfg.wabaId ?? saved?.wabaId ?? null;
    // Templates: the account that answered last time, else the Messaging account first, then the WhatsApp account.
    const candidates = [...new Set([this.templateAccount, cfg.messagingAccountId, waba].filter((x): x is string => !!x))];
    return { wabaId: candidates[0] ?? null, token: cfg.envToken ?? saved?.accessToken ?? null, candidates };
  }
  private templateAccount: string | null = null;

  /**
   * Synchronous, for routing: APPROVED in the last reading AND Meta's approved wording is the code's wording (a
   * template changed in code but not yet at Meta would be refused, or worse, sent with the old words). Starts a
   * background refresh when the reading is old.
   */
  approved(name: string): boolean {
    const now = this.now();
    if (now - this.readAt > FRESH_MS && now >= this.retryAt) void this.refresh().catch(() => undefined);
    if (this.readAt > 0 && now - this.readAt > STALE_MS) return false;
    const s = this.states.get(name);
    return s?.status === 'APPROVED' && !this.drifted(name) && !this.recategorised(name);
  }

  /**
   * Meta moved the template to another category (e.g. Utility → Marketing). Never used then: a marketing message
   * may only go to customers who opted in to WhatsApp offers, and it is priced as marketing.
   */
  recategorised(name: string): boolean {
    const s = this.states.get(name);
    const want = expectedCategory(name);
    return !!s?.category && !!want && s.category.toUpperCase() !== want;
  }

  private shownStatus(name: string): string {
    const s = this.states.get(name);
    if (!s) return 'NOT_SUBMITTED';
    if (s.status === 'APPROVED' && this.recategorised(name)) return 'RECATEGORISED';
    if (s.status === 'APPROVED' && this.drifted(name)) return 'OUT_OF_DATE';
    return s.status;
  }

  /** Meta holds different words for this template than the code (authentication wording is Meta's own). */
  drifted(name: string): boolean {
    const s = this.states.get(name);
    const expected = expectedBody(name);
    if (!s || expected === null || s.bodyText === null) return false;
    return norm(s.bodyText) !== norm(expected);
  }

  /** Force the next routing check to re-read Meta (a webhook said something changed). */
  invalidate(): void { this.readAt = 0; this.retryAt = 0; void this.refresh().catch(() => undefined); }

  async refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const { token, candidates } = await this.credentials();
        if (!candidates.length || !token) { this.lastError = 'not configured'; return; }
        let lastFailure = '';
        // An account can answer with an empty or foreign list (Meta's split accounts): prefer the first one that
        // holds any of our templates, and fall back to the first that answered at all.
        const ourNames = new Set([...Object.values(WHATSAPP_TEMPLATES).map((t) => t.name), CARE_ALERT_TEMPLATE.name]);
        let firstAnswer: { accountId: string; states: Map<string, MetaTemplateState> } | null = null;
        for (const accountId of candidates) {
        const next = new Map<string, MetaTemplateState>();
        let failed = false;
        let url: string | null = `${GRAPH}/${accountId}/message_templates?fields=id,name,status,category,language,rejected_reason,components&limit=200`;
        for (let page = 0; url && page < 5; page++) {
          const res: Response = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
          const json = (await res.json().catch(() => null)) as { data?: Array<Record<string, unknown>>; paging?: { next?: string }; error?: { message?: string; code?: number } } | null;
          if (!res.ok) { lastFailure = `${res.status}${json?.error?.code ? ` ${json.error.code}` : ''} ${String(json?.error?.message ?? '').slice(0, 120)}`.trim(); failed = true; break; }
          for (const t of json?.data ?? []) {
            const name = String(t.name ?? '');
            // Our language only; another language's copy of the same name is not what we send.
            if (name && (!t.language || String(t.language) === 'en')) {
              const body = Array.isArray(t.components) ? (t.components as Array<Record<string, unknown>>).find((c) => String(c.type).toUpperCase() === 'BODY') : null;
              next.set(name, { id: t.id ? String(t.id) : null, name, status: String(t.status ?? 'UNKNOWN'), category: t.category ? String(t.category) : null, language: t.language ? String(t.language) : null, rejectedReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? String(t.rejected_reason) : null, bodyText: typeof body?.text === 'string' ? body.text : null });
            }
          }
          url = json?.paging?.next ?? null;
        }
        if (failed) continue;
        if (![...next.keys()].some((n) => ourNames.has(n))) { firstAnswer ??= { accountId, states: next }; continue; }
        this.states = next; this.readAt = this.now(); this.lastError = null; this.templateAccount = accountId;
        return;
        }
        if (firstAnswer) { this.states = firstAnswer.states; this.readAt = this.now(); this.lastError = null; this.templateAccount = firstAnswer.accountId; return; }
        this.lastError = lastFailure || 'Meta did not list the templates';
        this.retryAt = this.now() + RETRY_MS;
      } catch (e) {
        this.lastError = e instanceof Error ? e.message.slice(0, 120) : 'unreachable';
        this.retryAt = this.now() + RETRY_MS;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  /** Our templates beside Meta's status for each (refreshes first). */
  async rows(): Promise<{ rows: TemplateRow[]; error: string | null; readAt: number }> {
    await this.refresh();
    const rows: TemplateRow[] = Object.entries(WHATSAPP_TEMPLATES).map(([ours, spec]) => {
      const s = this.states.get(spec.name);
      return { ours, name: spec.name, category: spec.category, status: this.shownStatus(spec.name), rejectedReason: s?.rejectedReason ?? null };
    });
    const alert = this.states.get(CARE_ALERT_TEMPLATE.name);
    rows.push({ ours: 'CARE_ALERT', name: CARE_ALERT_TEMPLATE.name, category: CARE_ALERT_TEMPLATE.category, status: this.shownStatus(CARE_ALERT_TEMPLATE.name), rejectedReason: alert?.rejectedReason ?? null });
    return { rows, error: this.lastError, readAt: this.readAt };
  }

  /** Submit every template Meta does not have (or rejected, under the same name it cannot be resubmitted: reported). */
  async submitMissing(): Promise<{ submitted: string[]; failed: Array<{ name: string; reason: string }>; skipped: string[] }> {
    await this.refresh();
    const { wabaId, token } = await this.credentials();
    if (!wabaId || !token) return { submitted: [], failed: [{ name: '*', reason: 'WhatsApp is not configured (WABA id and token).' }], skipped: [] };
    await this.refresh();
    if (this.lastError) return { submitted: [], failed: [{ name: '*', reason: `Meta did not list the templates: ${this.lastError}` }], skipped: [] };
    const bodies = [...Object.values(WHATSAPP_TEMPLATES).map((spec) => ({ name: spec.name, body: metaTemplateCreateBody(spec) })), { name: CARE_ALERT_TEMPLATE.name, body: careAlertCreateBody() }];
    const out = { submitted: [] as string[], failed: [] as Array<{ name: string; reason: string }>, skipped: [] as string[] };
    for (const b of bodies) {
      const existing = this.states.get(b.name);
      // Already at Meta with the code's words: nothing to do. Changed in code: an edit of the same template.
      if (existing && !(this.drifted(b.name) && existing.id)) { out.skipped.push(b.name); continue; }
      const editing = !!existing;
      try {
        const target = editing ? `${GRAPH}/${existing!.id}` : `${GRAPH}/${wabaId}/message_templates`;
        const payload = editing ? { components: (b.body as { components: unknown }).components } : b.body;
        const res = await this.fetchImpl(target, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
        const json = (await res.json().catch(() => null)) as { status?: string; error?: { message?: string; error_user_msg?: string; code?: number } } | null;
        if (res.ok) out.submitted.push(b.name);
        else out.failed.push({ name: b.name, reason: `${res.status} ${String(json?.error?.error_user_msg ?? json?.error?.message ?? '').slice(0, 200)}`.trim() });
      } catch (e) {
        out.failed.push({ name: b.name, reason: e instanceof Error ? e.message.slice(0, 120) : 'unreachable' });
      }
    }
    this.readAt = 0;
    await this.refresh();
    return out;
  }
}

/** A delivery receipt said failed: the attempt carrying that Meta message id (wamid) is recorded as FAILED. */
export async function markWhatsAppDeliveryFailed(messageId: string, message: string): Promise<void> {
  await db.update(notificationAttempts).set({ status: 'FAILED', providerMessage: message })
    .where(and(eq(notificationAttempts.providerCode, messageId.slice(0, 160)), eq(notificationAttempts.status, 'SENT')));
}
