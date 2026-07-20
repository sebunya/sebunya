import { createHash } from 'node:crypto';

export const BEHAVIOURAL_INTERVENTION_POLICY = 'behavioural-intervention-v1';
export const INTERVENTION_STATUSES = ['DRAFT','PENDING_APPROVAL','APPROVED','ACTIVE','PAUSED','COMPLETED','REJECTED'] as const;
export type InterventionStatus = typeof INTERVENTION_STATUSES[number];
export const TARGET_BEHAVIOURS = ['PRODUCT_DISCOVERY','CHECKOUT_COMPLETION','PRODUCT_EDUCATION','FEEDBACK_COMPLETION'] as const;
export type TargetBehaviour = typeof TARGET_BEHAVIOURS[number];
export type InterventionOutcome = 'ENGAGED' | 'DISMISSED' | 'TARGET_ACHIEVED';
export interface InterventionAudience { lifecycleStages: string[]; }
export interface InterventionContent { title: string; body: string; ctaLabel: string; ctaPath: string; disclosure: string; dismissible: true; }
export interface InterventionSuppression { maxImpressions: number; windowHours: number; suppressAfterDismissal: boolean; }

const manipulative = /(only\s+\d+\s+left|act\s+now|hurry|last\s+chance|everyone\s+is\s+buying|guaranteed|you\s+must|don't\s+miss\s+out|countdown|limited\s+time)/i;
export function validateEthicalIntervention(input: { targetBehaviour: TargetBehaviour; channel: string; placement: string; content: InterventionContent; suppression: InterventionSuppression; audience: InterventionAudience }): string[] {
  const errors: string[] = [];
  if (!TARGET_BEHAVIOURS.includes(input.targetBehaviour)) errors.push('Target behaviour is unsupported.');
  if (input.channel !== 'ON_SITE') errors.push('Only the provider-free ON_SITE channel is supported.');
  if (!/^[A-Z][A-Z0-9_]{2,39}$/.test(input.placement)) errors.push('Placement must be a bounded identifier.');
  const text = `${input.content.title} ${input.content.body} ${input.content.ctaLabel} ${input.content.disclosure}`;
  if (input.content.title.trim().length < 3 || input.content.title.length > 120 || input.content.body.trim().length < 3 || input.content.body.length > 500) errors.push('Title and body must be bounded and meaningful.');
  if (input.content.ctaLabel.trim().length < 2 || input.content.ctaLabel.length > 80) errors.push('CTA label must be bounded.');
  if (!/^\/(?!\/)[A-Za-z0-9/_?=&%+.-]*$/.test(input.content.ctaPath) || /checkout|payment|pesapal/i.test(input.content.ctaPath)) errors.push('CTA must be a safe local non-transaction path.');
  if (input.content.disclosure.trim().length < 3 || input.content.disclosure.length > 240) errors.push('A truthful bounded disclosure is required.');
  if (input.content.dismissible !== true) errors.push('Every intervention must be dismissible.');
  if (manipulative.test(text)) errors.push('Manipulative urgency, scarcity or coercion language is forbidden.');
  if (!Number.isInteger(input.suppression.maxImpressions) || input.suppression.maxImpressions < 1 || input.suppression.maxImpressions > 20) errors.push('Impression cap must be between 1 and 20.');
  if (!Number.isInteger(input.suppression.windowHours) || input.suppression.windowHours < 1 || input.suppression.windowHours > 720) errors.push('Suppression window must be between 1 and 720 hours.');
  if (input.audience.lifecycleStages.length > 10 || input.audience.lifecycleStages.some((stage) => !/^[A-Z_]{2,30}$/.test(stage))) errors.push('Audience lifecycle stages are invalid.');
  return [...new Set(errors)];
}

export function interventionDigest(input: unknown): string { return createHash('sha256').update(JSON.stringify(input)).digest('hex'); }
export function interventionParticipantHash(userId: string): string { return createHash('sha256').update(`behavioural-intervention:v1:${userId}`).digest('hex'); }

const transitions: Record<InterventionStatus, InterventionStatus[]> = {
  DRAFT: ['PENDING_APPROVAL'], PENDING_APPROVAL: ['APPROVED','REJECTED'], APPROVED: ['ACTIVE'], ACTIVE: ['PAUSED','COMPLETED'], PAUSED: ['ACTIVE','COMPLETED'], COMPLETED: [], REJECTED: [],
};
export function canTransitionIntervention(from: InterventionStatus, to: InterventionStatus): boolean { return transitions[from].includes(to); }
