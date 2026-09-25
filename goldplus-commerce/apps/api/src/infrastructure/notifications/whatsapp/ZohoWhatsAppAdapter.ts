import { outboundGovernance } from '../OutboundGovernanceService';
import { failsReleaseReadiness } from '../../../domain/notifications/OutboundGovernancePolicy';
import { classifyMessage, classifyTemplate } from '../messageClassification';
import {
  INotificationProvider,
  NotificationDispatchPayload,
  NotificationDispatchResult,
  NotificationStatus,
} from '../../../application/ports/INotificationProvider';
import { resilientFetch } from '../../http/HttpClient';
import { readFlag } from '../../../domain/notifications/OutboundGovernancePolicy';
import { readZohoWhatsAppConfig, zohoTemplateKeyFor, type ZohoWhatsAppConfig } from '../../../config/zohoWhatsApp';
import { fillWhatsAppVariables, whatsAppTemplateSpec } from './zohoWhatsAppTemplates';

/**
 * WhatsApp through Zoho CPaaS (formerly ZeptoMail) — the same account family as
 * our email. docs/notifications/whatsapp-zoho.md has the sources.
 *
 *   POST https://cpaas.zoho.com/v1.1/whatsapp
 *   Authorization: <Agent Send API key>
 *   { from, to, template_key, merge_info: { <merge_key>: <merge_value> } }
 *
 * Mirrors ZeptoMailAdapter: ONE governance decision from the shared policy, a
 * DRY_RUN that exercises the same mapping a live send would, NOT_CONFIGURED with
 * no network call when anything is missing, and the provider's own answer kept
 * (bounded, secret-free) and classified retryable or not.
 *
 * API key, not OAuth: the documented auth is a static Send API key, so there is
 * no access token to fetch, cache or refresh.
 */

export type ZohoWhatsAppFailureClass =
  | 'auth_rejected'
  | 'rate_limited'
  | 'invalid_template'
  | 'recipient_rejected'
  | 'credits_exhausted'
  | 'invalid_request'
  | 'provider_unavailable';

/**
 * Classifies a Zoho CPaaS refusal. Zoho documents the envelope (HTTP status,
 * `error.code`, `error.message`, `error.details[].field`) but publishes no list
 * of WhatsApp error codes, so the class comes from the HTTP status first and
 * from the field named in `error.details` or words in the message second —
 * never from a guessed code.
 */
export function classifyZohoWhatsAppFailure(
  status: number,
  body: unknown,
): { classification: ZohoWhatsAppFailureClass; retryable: boolean } {
  const err = (body && typeof body === 'object' ? ((body as any).error ?? (body as any).data ?? {}) : {}) as any;
  const details: any[] = Array.isArray(err?.details) ? err.details : [];
  const fields = details.map((d) => String(d?.field ?? '').toLowerCase());
  const text = `${String(err?.code ?? err?.error_code ?? '')} ${String(err?.message ?? '')} ${details
    .map((d) => String(d?.message ?? ''))
    .join(' ')}`.toLowerCase();

  if (status === 401 || status === 403) return { classification: 'auth_rejected', retryable: false };
  if (status === 429) return { classification: 'rate_limited', retryable: true };
  if (status >= 500) return { classification: 'provider_unavailable', retryable: true };
  if (/credit|balance|insufficient/.test(text)) return { classification: 'credits_exhausted', retryable: false };
  if (fields.some((f) => f.includes('template')) || /template/.test(text)) {
    return { classification: 'invalid_template', retryable: false };
  }
  if (fields.some((f) => f === 'to' || f.includes('mobile') || f.includes('phone')) || /not on whatsapp|not a whatsapp|invalid (mobile|phone|number|recipient)|recipient/.test(text)) {
    return { classification: 'recipient_rejected', retryable: false };
  }
  // Any other 4xx: our request is wrong, and sending it again will not fix it.
  return { classification: 'invalid_request', retryable: false };
}

/**
 * The ONE place the Zoho request body is built. Everything the docs leave
 * uncertain is here and nowhere else:
 *   - `to` / `from` are sent as digits with country code and no '+'. The docs
 *     show only "<TO_PHONE_NUMBER>".
 *   - `merge_info` is keyed by the template's NAMED variables ({{customer_name}}),
 *     as the template editor describes. If Zoho turns out to want positional
 *     keys ("1", "2"), change `name` to the 1-based index here.
 */
export function toZohoWhatsAppRequest(
  cfg: Pick<ZohoWhatsAppConfig, 'fromNumber'>,
  to: string,
  templateKey: string,
  values: Array<{ name: string; value: string }>,
): { from: string; to: string; template_key: string; merge_info: Record<string, string> } {
  const merge_info: Record<string, string> = {};
  for (const v of values) merge_info[v.name] = v.value;
  return { from: cfg.fromNumber, to, template_key: templateKey, merge_info };
}

export class ZohoWhatsAppAdapter implements INotificationProvider {
  /** Uganda first (0772…, 256772…, +256772…); any other +<country> number accepted as digits. */
  public normalizeNumber(phone: string): string | null {
    const raw = (phone || '').trim();
    const clean = raw.replace(/[\s\-()]/g, '');
    const digits = clean.replace(/^\+/, '');
    if (!/^\d+$/.test(digits)) return null;
    if (digits.startsWith('0') && digits.length === 10) return '256' + digits.slice(1);
    if (digits.startsWith('256')) return digits.length === 12 ? digits : null;
    if (clean.startsWith('+') && digits.length >= 10 && digits.length <= 15) return digits;
    return null;
  }

  public maskPhone(phone: string): string {
    if (phone.length <= 6) return '******';
    return phone.slice(0, 5) + '******' + phone.slice(-2);
  }

  /** Removes the API key and any full phone number from a provider or network message. */
  public sanitize(msg: string, env: NodeJS.ProcessEnv = process.env): string {
    let out = msg;
    const key = (env.ZOHO_WHATSAPP_API_KEY || '').trim();
    if (key) out = out.split(key).join('******');
    out = out.replace(/(zoho-enczapikey|bearer)\s+\S+/gi, '$1 ******');
    out = out.replace(/\+?\d{10,15}/g, (m) => this.maskPhone(m.replace(/^\+/, '')));
    return out.replace(/\s+/g, ' ').slice(0, 300);
  }

  canCarry(template: string, recipient: string, data: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): boolean {
    if (!readFlag(env.NOTIFICATIONS_WHATSAPP_ENABLED)) return false;
    // Transactional only. Marketing on WhatsApp needs an explicit WhatsApp
    // opt-in, and this platform records none — so marketing never goes here.
    if (classifyTemplate(template) !== 'TRANSACTIONAL') return false;
    if (!readZohoWhatsAppConfig(env).configured) return false;
    const spec = whatsAppTemplateSpec(template);
    if (!spec || !zohoTemplateKeyFor(template, env)) return false;
    if (!this.normalizeNumber(recipient)) return false;
    return fillWhatsAppVariables(spec, data ?? {}).ok;
  }

  async dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    const to = this.normalizeNumber(payload.recipient || '');
    if (!to) {
      return {
        status: 'FAILED' as NotificationStatus,
        providerCode: 'INVALID_RECIPIENT',
        providerMessage: 'WhatsApp not sent: the recipient is not a phone number with a country code.',
        retryable: false,
      };
    }

    const cfg = readZohoWhatsAppConfig();
    const allowlist = (process.env.NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS || '')
      .split(',')
      .map((item) => this.normalizeNumber(item.trim()))
      .filter((item): item is string => item !== null);
    const recipientAllowlisted = allowlist.includes(to);
    const messageClass = classifyMessage(payload);

    const decision = outboundGovernance.decide({
      channel: 'WHATSAPP',
      messageClass,
      recipientClass: messageClass === 'OPERATIONAL' ? 'INTERNAL' : recipientAllowlisted ? 'TEST' : 'CUSTOMER',
      providerConfigured: cfg.configured,
      allowlistActive: allowlist.length > 0,
      recipientAllowlisted,
      maskedRecipient: this.maskPhone(to),
    });

    if (decision.kind !== 'ALLOW_LIVE' && decision.kind !== 'ALLOW_DRY_RUN') {
      return {
        status: (decision.kind === 'BLOCK_PROVIDER_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'DISABLED') as NotificationStatus,
        providerCode: decision.kind,
        providerMessage: `WhatsApp not sent: ${decision.guard}.`,
      };
    }

    // The template: mapped by us AND keyed by the owner, or not sent here at all.
    const spec = whatsAppTemplateSpec(payload.template);
    const templateKey = zohoTemplateKeyFor(payload.template);
    if (!spec || !templateKey) {
      return {
        status: 'NOT_CONFIGURED' as NotificationStatus,
        providerCode: 'TEMPLATE_NOT_MAPPED',
        providerMessage: spec
          ? `WhatsApp not sent: no Zoho template key for ${payload.template} (ZOHO_WHATSAPP_TEMPLATE_${payload.template.toUpperCase()}).`
          : `WhatsApp not sent: ${payload.template} has no WhatsApp template.`,
      };
    }
    const filled = fillWhatsAppVariables(spec, (payload.data || {}) as Record<string, unknown>);
    if (!filled.ok) {
      return {
        status: 'FAILED' as NotificationStatus,
        providerCode: 'TEMPLATE_DATA_MISSING',
        providerMessage: `WhatsApp not sent: missing ${filled.missing.join(', ')} for ${payload.template}.`,
        retryable: false,
      };
    }
    const body = toZohoWhatsAppRequest(cfg, to, templateKey, filled.values);

    // Simulated only after the request is built, so a dry run proves the mapping.
    if (decision.kind === 'ALLOW_DRY_RUN') {
      return {
        status: 'DRY_RUN' as NotificationStatus,
        providerCode: 'DRY_RUN',
        providerMessage: `WhatsApp simulated (${spec.zohoName}). No message was sent.`,
      };
    }

    try {
      const response = await resilientFetch(cfg.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: cfg.apiKey,
        },
        body: JSON.stringify(body),
        breakerName: 'zoho-whatsapp',
        timeoutMs: cfg.timeoutMs,
      });

      const text = await response.text().catch(() => '');
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      const hasError = Boolean(json && typeof json === 'object' && json.error);
      if (response.ok && !hasError) {
        const requestId = json?.data?.request_id ?? json?.request_id ?? null;
        return {
          status: 'SENT' as NotificationStatus,
          // Accepted by Zoho, which queues it. Delivery to the phone is not
          // reported back: Zoho documents no WhatsApp delivery webhook.
          providerCode: requestId ? String(requestId).slice(0, 50) : 'ACCEPTED',
          providerMessage: this.sanitize(`WhatsApp accepted by Zoho CPaaS: ${json?.data?.message ?? json?.message ?? 'queued'}`),
        };
      }

      const failure = classifyZohoWhatsAppFailure(response.status, json);
      const retryAfter = response.headers.get('retry-after');
      return {
        status: 'FAILED' as NotificationStatus,
        providerCode: `PROVIDER_${failure.classification.toUpperCase()}`,
        retryable: failure.retryable,
        providerMessage: this.sanitize(
          [
            `HTTP error status ${response.status}`,
            `class=${failure.classification}`,
            `retryable=${failure.retryable ? 'yes' : 'no'}`,
            retryAfter ? `retry-after=${retryAfter}` : '',
            text,
          ]
            .filter(Boolean)
            .join(' | '),
        ),
      };
    } catch (err: any) {
      const isTimeout = err?.name === 'AbortError';
      return {
        status: 'FAILED' as NotificationStatus,
        providerCode: 'PROVIDER_ERROR',
        providerMessage: this.sanitize(isTimeout ? 'Request timed out.' : String(err?.message || 'Unknown network error.')),
      };
    }
  }

  /**
   * Configuration check with no network call — the same shape as ZeptoMail's —
   * plus the three-state channel status the admin shows.
   */
  async getBalance(env: NodeJS.ProcessEnv = process.env): Promise<{
    status: 'PASS' | 'WARN' | 'FAIL' | 'NOT_CONFIGURED';
    channelState: 'NOT_CONFIGURED' | 'CONFIGURED_OFF' | 'CONFIGURED_DRY_RUN' | 'LIVE' | 'UNSAFE';
    guard: string;
    mappedTemplates: string[];
    message: string;
  }> {
    const cfg = readZohoWhatsAppConfig(env);
    const { ZOHO_WHATSAPP_TEMPLATES } = await import('./zohoWhatsAppTemplates');
    const mappedTemplates = Object.keys(ZOHO_WHATSAPP_TEMPLATES).filter((t) => zohoTemplateKeyFor(t, env));
    if (!cfg.configured) {
      return {
        status: 'NOT_CONFIGURED',
        channelState: 'NOT_CONFIGURED',
        guard: 'ZOHO_WHATSAPP_CONFIG',
        mappedTemplates,
        message: `WhatsApp (Zoho CPaaS): Not configured. ${cfg.problems.join(' ')}`,
      };
    }
    const verdict = outboundGovernance.configurationVerdict('WHATSAPP', true, env);
    if (failsReleaseReadiness(verdict)) {
      return {
        status: 'FAIL',
        channelState: 'UNSAFE',
        guard: verdict.guard,
        mappedTemplates,
        message: `WhatsApp (Zoho CPaaS): unsafe outbound configuration (${verdict.guard}); live sending is blocked.`,
      };
    }
    if (verdict.kind === 'ALLOW_LIVE') {
      return {
        status: 'WARN',
        channelState: 'LIVE',
        guard: verdict.guard,
        mappedTemplates,
        message: `WhatsApp (Zoho CPaaS): configured and LIVE. ${mappedTemplates.length} template(s) keyed.`,
      };
    }
    if (verdict.kind === 'ALLOW_DRY_RUN') {
      return {
        status: 'PASS',
        channelState: 'CONFIGURED_DRY_RUN',
        guard: verdict.guard,
        mappedTemplates,
        message: `WhatsApp (Zoho CPaaS): configured, dry run. ${mappedTemplates.length} template(s) keyed.`,
      };
    }
    return {
      status: 'PASS',
      channelState: 'CONFIGURED_OFF',
      guard: verdict.guard,
      mappedTemplates,
      message: `WhatsApp (Zoho CPaaS): configured but switched off (${verdict.guard}).`,
    };
  }
}
