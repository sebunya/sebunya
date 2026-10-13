import { OUTCOME_UNKNOWN_PROVIDER_CODE, type INotificationProvider, type NotificationDispatchPayload, type NotificationDispatchResult, type NotificationStatus } from '../../../application/ports/INotificationProvider';
import { outboundGovernance } from '../OutboundGovernanceService';
import { readFlag } from '../../../domain/notifications/OutboundGovernancePolicy';
import { classifyMessage, classifyTemplate } from '../messageClassification';
import { readMetaWhatsAppConfig } from '../../../config/metaWhatsApp';
import { META_GRAPH_VERSION } from '../../advertising/AdPlatforms';
import { fillWhatsAppVariables, metaTemplateSendObject, whatsAppTemplateSpec } from './whatsAppTemplates';
import type { MetaWhatsAppTemplateCatalog } from './MetaWhatsAppTemplateCatalog';

export type MetaWhatsAppFailureClass = 'auth_rejected' | 'rate_limited' | 'invalid_template' | 'recipient_rejected' | 'account_blocked' | 'invalid_request' | 'provider_unavailable';

/**
 * Classifies a Cloud API refusal from Meta's documented error codes (WhatsApp Cloud API error codes page),
 * HTTP status second. Retryable only where Meta says waiting helps.
 */
export function classifyMetaWhatsAppFailure(status: number, body: unknown): { classification: MetaWhatsAppFailureClass; retryable: boolean; code: number | null } {
  const err = (body && typeof body === 'object' ? (body as { error?: { code?: unknown } }).error : null) ?? {};
  const code = Number.isFinite(Number((err as { code?: unknown }).code)) ? Number((err as { code?: unknown }).code) : null;
  const is = (...codes: number[]) => code !== null && codes.includes(code);
  if (is(0, 190, 10, 200, 3)) return { classification: 'auth_rejected', retryable: false, code };
  if (is(4, 80007, 130429, 131048, 131056) || status === 429) return { classification: 'rate_limited', retryable: true, code };
  if (is(131026, 131021, 131030, 131050, 131049)) return { classification: 'recipient_rejected', retryable: false, code };
  if (is(132000, 132001, 132005, 132007, 132012, 132015, 132016, 132068, 132069)) return { classification: 'invalid_template', retryable: false, code };
  if (is(131031, 131042, 368, 131045)) return { classification: 'account_blocked', retryable: false, code };
  if (is(1, 2, 131000, 131016) || status >= 500) return { classification: 'provider_unavailable', retryable: true, code };
  return { classification: 'invalid_request', retryable: false, code };
}

/**
 * Customer WhatsApp messages sent directly through Meta's WhatsApp Cloud API (primary; Zoho CPaaS is the
 * fallback, SMS the last resort). Same contract as the Zoho adapter: ONE governance decision, a dry run that
 * builds the real request, NOT_CONFIGURED with no network call when anything is missing, Meta's answer kept
 * (bounded, secret-free) and classified. A template is offered only when Meta has APPROVED it.
 */
export class MetaWhatsAppAdapter implements INotificationProvider {
  constructor(
    private readonly catalog: MetaWhatsAppTemplateCatalog,
    private readonly token: () => Promise<string | null>,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly hooks: {
      /** The customer replied STOP on WhatsApp: their updates go by SMS instead. */
      isOptedOut?: (phoneE164: string) => Promise<boolean>;
      /** Every outcome (metrics), and Meta's class when it refused (an auth refusal pages the team). */
      onOutcome?: (outcome: string, classification: MetaWhatsAppFailureClass | null) => void;
    } = {},
  ) {}

  normalizeNumber(phone: string): string | null {
    const clean = (phone || '').trim().replace(/[\s\-()]/g, '');
    const digits = clean.replace(/^\+/, '');
    if (!/^\d+$/.test(digits)) return null;
    if (digits.startsWith('0') && digits.length === 10) return '256' + digits.slice(1);
    if (digits.startsWith('256')) return digits.length === 12 ? digits : null;
    if (clean.startsWith('+') && digits.length >= 10 && digits.length <= 15) return digits;
    return null;
  }

  private mask(p: string) { return p.length <= 6 ? '******' : `${p.slice(0, 5)}******${p.slice(-2)}`; }
  sanitize(msg: string, token?: string | null): string {
    let out = msg;
    if (token) out = out.split(token).join('******');
    out = out.replace(/bearer\s+\S+/gi, 'Bearer ******').replace(/\+?\d{10,15}/g, (m) => this.mask(m.replace(/^\+/, '')));
    return out.replace(/\s+/g, ' ').slice(0, 300);
  }

  canCarry(template: string, recipient: string, data: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): boolean {
    if (!readFlag(env.NOTIFICATIONS_WHATSAPP_ENABLED)) return false;
    if (classifyTemplate(template) !== 'TRANSACTIONAL') return false;
    if (!readMetaWhatsAppConfig(env).configured) return false;
    const spec = whatsAppTemplateSpec(template);
    if (!spec || !this.catalog.approved(spec.name)) return false;
    if (!this.normalizeNumber(recipient)) return false;
    return fillWhatsAppVariables(spec, data ?? {}).ok;
  }

  async dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    const to = this.normalizeNumber(payload.recipient || '');
    if (!to) return { status: 'FAILED' as NotificationStatus, providerCode: 'INVALID_RECIPIENT', providerMessage: 'WhatsApp not sent: the recipient is not a phone number with a country code.', retryable: false };
    const cfg = readMetaWhatsAppConfig();
    const token = cfg.envToken ?? (await this.token().catch(() => null));
    const allowlist = (process.env.NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS || '').split(',').map((i) => this.normalizeNumber(i.trim())).filter((i): i is string => i !== null);
    const recipientAllowlisted = allowlist.includes(to);
    const messageClass = classifyMessage(payload);
    const decision = await outboundGovernance.decideForRecipient({
      channel: 'WHATSAPP', messageClass,
      recipientClass: messageClass === 'OPERATIONAL' ? 'INTERNAL' : recipientAllowlisted ? 'TEST' : 'CUSTOMER',
      providerConfigured: cfg.configured && !!token, allowlistActive: allowlist.length > 0, recipientAllowlisted, maskedRecipient: this.mask(to),
    }, `phone:+${to}`);
    if (decision.kind !== 'ALLOW_LIVE' && decision.kind !== 'ALLOW_DRY_RUN') {
      return { status: (decision.kind === 'BLOCK_PROVIDER_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'DISABLED') as NotificationStatus, providerCode: decision.kind, providerMessage: `WhatsApp (Meta) not sent: ${decision.guard}.` };
    }
    const spec = whatsAppTemplateSpec(payload.template);
    // A customer who replied STOP gets the SMS instead (the phone code they asked for is still sent).
    if (spec && spec.category !== 'AUTHENTICATION' && messageClass !== 'OPERATIONAL' && this.hooks.isOptedOut && await this.hooks.isOptedOut(`+${to}`).catch(() => false)) {
      this.hooks.onOutcome?.('opted_out', null);
      return { status: 'NOT_CONFIGURED' as NotificationStatus, providerCode: 'RECIPIENT_OPTED_OUT', providerMessage: 'WhatsApp not sent: the customer replied STOP on WhatsApp; SMS instead.' };
    }
    if (!spec) return { status: 'NOT_CONFIGURED' as NotificationStatus, providerCode: 'TEMPLATE_NOT_MAPPED', providerMessage: `WhatsApp not sent: ${payload.template} has no WhatsApp template.` };
    if (!this.catalog.approved(spec.name)) return { status: 'NOT_CONFIGURED' as NotificationStatus, providerCode: 'TEMPLATE_NOT_APPROVED', providerMessage: `WhatsApp (Meta) not sent: ${spec.name} is not approved by Meta yet.` };
    const filled = fillWhatsAppVariables(spec, (payload.data || {}) as Record<string, unknown>);
    if (!filled.ok) return { status: 'FAILED' as NotificationStatus, providerCode: 'TEMPLATE_DATA_MISSING', providerMessage: `WhatsApp not sent: missing ${filled.missing.join(', ')} for ${payload.template}.`, retryable: false };
    const body = { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template', template: metaTemplateSendObject(spec, filled.values) };
    if (decision.kind === 'ALLOW_DRY_RUN') return { status: 'DRY_RUN' as NotificationStatus, providerCode: 'DRY_RUN', providerMessage: `WhatsApp (Meta) simulated (${spec.name}). No message was sent.` };

    try {
      const res = await this.fetchImpl(`https://graph.facebook.com/${META_GRAPH_VERSION}/${cfg.phoneNumberId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
      });
      const text = await res.text().catch(() => '');
      let json: { messages?: Array<{ id?: string; message_status?: string }>; error?: unknown } | null = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (res.ok && json?.messages?.[0]) {
        this.hooks.onOutcome?.('sent', null);
        // The wamid: delivery and read receipts arrive on the webhook under this id.
        return { status: 'SENT' as NotificationStatus, providerCode: String(json.messages[0].id ?? 'ACCEPTED').slice(0, 120), providerMessage: `WhatsApp accepted by Meta (${spec.name}).` };
      }
      const f = classifyMetaWhatsAppFailure(res.status, json);
      this.hooks.onOutcome?.('failed', f.classification);
      return {
        status: 'FAILED' as NotificationStatus, providerCode: `META_${f.classification.toUpperCase()}`, retryable: f.retryable,
        providerMessage: this.sanitize([`HTTP ${res.status}`, f.code !== null ? `code=${f.code}` : '', `class=${f.classification}`, text].filter(Boolean).join(' | '), token),
      };
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || (err as Error)?.name === 'TimeoutError') {
        // Sent, no answer: Meta may have delivered it. Neither re-sent nor handed to a fallback.
        this.hooks.onOutcome?.('unknown', null);
        return { status: 'FAILED' as NotificationStatus, providerCode: OUTCOME_UNKNOWN_PROVIDER_CODE, retryable: false, providerMessage: 'WhatsApp (Meta) timed out after sending; outcome unknown. Not retried, no fallback.' };
      }
      return { status: 'FAILED' as NotificationStatus, providerCode: 'PROVIDER_ERROR', providerMessage: this.sanitize(String((err as Error)?.message || 'network error'), token) };
    }
  }

  async getBalance(): Promise<{ status: 'PASS' | 'WARN' | 'FAIL' | 'NOT_CONFIGURED'; channelState: 'NOT_CONFIGURED' | 'CONFIGURED_OFF' | 'CONFIGURED_DRY_RUN' | 'LIVE' | 'UNSAFE'; guard: string; mappedTemplates: string[]; message: string }> {
    const cfg = readMetaWhatsAppConfig();
    const { rows, error } = await this.catalog.rows();
    const approved = rows.filter((r) => r.status === 'APPROVED' && r.ours !== 'CARE_ALERT').map((r) => r.ours);
    if (!cfg.configured) return { status: 'NOT_CONFIGURED', channelState: 'NOT_CONFIGURED', guard: 'META_WHATSAPP_CONFIG', mappedTemplates: approved, message: `WhatsApp (Meta): Not configured. ${cfg.problems.join(' ')}` };
    const verdict = outboundGovernance.configurationVerdict('WHATSAPP', true);
    const state = verdict.kind === 'ALLOW_LIVE' ? 'LIVE' : verdict.kind === 'ALLOW_DRY_RUN' ? 'CONFIGURED_DRY_RUN' : 'CONFIGURED_OFF';
    return { status: error ? 'WARN' : 'PASS', channelState: state, guard: verdict.guard, mappedTemplates: approved, message: `WhatsApp (Meta): ${state.toLowerCase().replace(/_/g, ' ')}. ${approved.length} of ${rows.length - 1} customer templates approved by Meta.${error ? ` Meta did not answer: ${error}.` : ''}` };
  }
}

/**
 * Meta first, Zoho second (owner, 2026-10-14: "zoho should be second, should Meta fail"). Zoho is tried only when
 * Meta could not carry the message or definitely did not send it (refused, not configured, unreachable). A Meta
 * timeout is never followed by Zoho: the message may already be on the phone. SMS stays the router's last resort.
 */
export class FailoverWhatsAppProvider implements INotificationProvider {
  constructor(private readonly primary: MetaWhatsAppAdapter, private readonly secondary: INotificationProvider & { canCarry?: INotificationProvider['canCarry'] }, private readonly optedOut?: (phoneE164: string) => Promise<boolean>) {}

  canCarry(template: string, recipient: string, data: Record<string, unknown>): boolean {
    return this.primary.canCarry(template, recipient, data) || this.secondary.canCarry?.(template, recipient, data) === true;
  }

  async dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    const data = (payload.data || {}) as Record<string, unknown>;
    const secondaryCan = this.secondary.canCarry?.(payload.template, payload.recipient, data) === true;
    if (!this.primary.canCarry(payload.template, payload.recipient, data)) {
      if (!secondaryCan) return this.primary.dispatch(payload);
      // Zoho alone still honours a WhatsApp STOP.
      const to = this.primary.normalizeNumber(payload.recipient);
      if (to && this.optedOut && await this.optedOut(`+${to}`).catch(() => false)) return { status: 'NOT_CONFIGURED', providerCode: 'RECIPIENT_OPTED_OUT', providerMessage: 'WhatsApp not sent: the customer replied STOP on WhatsApp; SMS instead.' };
      return this.secondary.dispatch(payload);
    }
    const first = await this.primary.dispatch(payload);
    const definitelyNotSent = first.status === 'FAILED' || first.status === 'NOT_CONFIGURED';
    // Never Zoho after: a possible delivery (timeout), data or number problems Zoho would repeat, or a STOP (it is
    // the customer's choice about WhatsApp, whoever sends it).
    if (!definitelyNotSent || !secondaryCan || [OUTCOME_UNKNOWN_PROVIDER_CODE, 'TEMPLATE_DATA_MISSING', 'INVALID_RECIPIENT', 'RECIPIENT_OPTED_OUT', 'META_RECIPIENT_REJECTED'].includes(String(first.providerCode))) return first;
    const second = await this.secondary.dispatch(payload);
    return { ...second, providerMessage: `${second.providerMessage} (Meta first: ${first.providerCode})`.slice(0, 400) };
  }

  getBalance() { return this.primary.getBalance(); }
}
