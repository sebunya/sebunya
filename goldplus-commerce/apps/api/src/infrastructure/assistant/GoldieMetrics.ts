import * as client from 'prom-client';

/** One metric per name per process (a second module instance must not re-register; see db/client.ts). */
function once<T extends client.Metric, C>(Kind: new (config: C) => T, config: C & { name: string }): T {
  return (client.register.getSingleMetric(config.name) as T | undefined) ?? new Kind(config);
}

/** Goldie's operational metrics, scraped from the api's /metrics (Prometheus, ops/prometheus/goldie.rules.yml). */
export const goldieMetrics = {
  whatsappMessages: once(client.Counter, { name: 'goldie_whatsapp_messages_total', help: 'WhatsApp customer messages by outcome (answered, silent, held, send_failed, duplicate, skipped, failed)', labelNames: ['outcome'] as const }),
  careAlerts: once(client.Counter, { name: 'goldie_care_alerts_total', help: 'Care Desk alerts queued, by channel', labelNames: ['channel'] as const }),
  escalations: once(client.Counter, { name: 'goldie_care_escalations_total', help: 'Urgent tasks re-paged because nobody took them' }),
  socialMessages: once(client.Counter, { name: 'goldie_social_messages_total', help: 'Messenger and Instagram messages Goldie handled, by platform and outcome', labelNames: ['platform', 'outcome'] as const }),
  recovered: once(client.Counter, { name: 'goldie_whatsapp_recovered_total', help: 'WhatsApp replies finished by the recovery pass after an interruption' }),
  urgentOpen: once(client.Gauge, { name: 'goldie_care_urgent_open', help: 'Urgent Care Desk tasks still open' }),
  oldestOpenMinutes: once(client.Gauge, { name: 'goldie_care_oldest_open_minutes', help: 'Minutes the longest-waiting open task has waited' }),
  spendRatio: once(client.Gauge, { name: 'goldie_model_spend_ratio', help: 'This month\'s model spend (settled + reserved) as a share of the cap' }),
};
