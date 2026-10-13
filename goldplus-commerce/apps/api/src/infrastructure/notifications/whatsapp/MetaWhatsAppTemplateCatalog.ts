import { META_GRAPH_VERSION } from '../../advertising/AdPlatforms';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { notificationAttempts } from '../../db/schema/phase11';
import { readMetaWhatsAppConfig } from '../../../config/metaWhatsApp';
import { CARE_ALERT_TEMPLATE, WHATSAPP_TEMPLATES, careAlertCreateBody, metaTemplateCreateBody } from './whatsAppTemplates';

export interface MetaTemplateState { name: string; status: string; category: string | null; language: string | null; rejectedReason: string | null }
export interface TemplateRow { ours: string; name: string; category: string; status: string; rejectedReason: string | null }

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const FRESH_MS = 10 * 60_000;

/**
 * What Meta says about our templates: approved, pending, rejected, paused. A template is sent only when Meta
 * says APPROVED. Read from Meta at most every 10 minutes (refreshed in the background, never in a send's way),
 * and on demand from the admin page. Also submits the templates Meta does not have yet.
 */
export class MetaWhatsAppTemplateCatalog {
  private states = new Map<string, MetaTemplateState>();
  private readAt = 0;
  private inflight: Promise<void> | null = null;
  lastError: string | null = null;

  constructor(private readonly account: () => Promise<{ wabaId: string; accessToken: string | null } | null>, private readonly fetchImpl: typeof fetch = fetch, private readonly now: () => number = () => Date.now()) {}

  /** The server setting wins; otherwise the WhatsApp account and token saved in the admin. */
  async credentials(): Promise<{ wabaId: string | null; token: string | null }> {
    const cfg = readMetaWhatsAppConfig();
    const saved = cfg.wabaId && cfg.envToken ? null : await this.account().catch(() => null);
    return { wabaId: cfg.wabaId ?? saved?.wabaId ?? null, token: cfg.envToken ?? saved?.accessToken ?? null };
  }

  /** Synchronous, for routing: APPROVED in the last reading. Starts a background refresh when the reading is old. */
  approved(name: string): boolean {
    if (this.now() - this.readAt > FRESH_MS) void this.refresh().catch(() => undefined);
    return this.states.get(name)?.status === 'APPROVED';
  }

  async refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const { wabaId, token } = await this.credentials();
        if (!wabaId || !token) { this.lastError = 'not configured'; return; }
        const next = new Map<string, MetaTemplateState>();
        let url: string | null = `${GRAPH}/${wabaId}/message_templates?fields=name,status,category,language,rejected_reason&limit=200`;
        for (let page = 0; url && page < 5; page++) {
          const res: Response = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
          const json = (await res.json().catch(() => null)) as { data?: Array<Record<string, unknown>>; paging?: { next?: string }; error?: { message?: string; code?: number } } | null;
          if (!res.ok) { this.lastError = `${res.status}${json?.error?.code ? ` ${json.error.code}` : ''} ${String(json?.error?.message ?? '').slice(0, 120)}`.trim(); return; }
          for (const t of json?.data ?? []) {
            const name = String(t.name ?? '');
            // Our language only; another language's copy of the same name is not what we send.
            if (name && (!t.language || String(t.language) === 'en')) next.set(name, { name, status: String(t.status ?? 'UNKNOWN'), category: t.category ? String(t.category) : null, language: t.language ? String(t.language) : null, rejectedReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? String(t.rejected_reason) : null });
          }
          url = json?.paging?.next ?? null;
        }
        this.states = next; this.readAt = this.now(); this.lastError = null;
      } catch (e) {
        this.lastError = e instanceof Error ? e.message.slice(0, 120) : 'unreachable';
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
      return { ours, name: spec.name, category: spec.category, status: s?.status ?? 'NOT_SUBMITTED', rejectedReason: s?.rejectedReason ?? null };
    });
    const alert = this.states.get(CARE_ALERT_TEMPLATE.name);
    rows.push({ ours: 'CARE_ALERT', name: CARE_ALERT_TEMPLATE.name, category: CARE_ALERT_TEMPLATE.category, status: alert?.status ?? 'NOT_SUBMITTED', rejectedReason: alert?.rejectedReason ?? null });
    return { rows, error: this.lastError, readAt: this.readAt };
  }

  /** Submit every template Meta does not have (or rejected, under the same name it cannot be resubmitted: reported). */
  async submitMissing(): Promise<{ submitted: string[]; failed: Array<{ name: string; reason: string }>; skipped: string[] }> {
    const { wabaId, token } = await this.credentials();
    if (!wabaId || !token) return { submitted: [], failed: [{ name: '*', reason: 'WhatsApp is not configured (WABA id and token).' }], skipped: [] };
    await this.refresh();
    if (this.lastError) return { submitted: [], failed: [{ name: '*', reason: `Meta did not list the templates: ${this.lastError}` }], skipped: [] };
    const bodies = [...Object.values(WHATSAPP_TEMPLATES).map((spec) => ({ name: spec.name, body: metaTemplateCreateBody(spec) })), { name: CARE_ALERT_TEMPLATE.name, body: careAlertCreateBody() }];
    const out = { submitted: [] as string[], failed: [] as Array<{ name: string; reason: string }>, skipped: [] as string[] };
    for (const b of bodies) {
      if (this.states.has(b.name)) { out.skipped.push(b.name); continue; }
      try {
        const res = await this.fetchImpl(`${GRAPH}/${wabaId}/message_templates`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b.body), signal: AbortSignal.timeout(15_000) });
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
