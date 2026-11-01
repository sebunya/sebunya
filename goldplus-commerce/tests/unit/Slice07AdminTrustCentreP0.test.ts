import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_READINESS_ITEMS,
  ADMIN_TRUST_MODULES,
  ADMIN_TRUST_STATUSES,
  adminStatusTone,
  isAdminTrustStatus,
} from '../../apps/web/src/lib/admin-trust-centre';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const dashboard = read('apps/web/src/pages/admin/index.astro');
const moduleCard = read('apps/web/src/components/admin/AdminModuleCard.astro');
const emptyState = read('apps/web/src/components/admin/AdminEmptyState.astro');
const readiness = read('apps/web/src/components/admin/AdminReadinessChecklist.astro');
const measurement = read('apps/web/src/pages/admin/measurement-control-tower.astro');
// R5 (2026-08-06): RecommendationRulePreviewPanel.astro was retired — its only
// consumer serialized the admin bearer token into HTML. The server-rendered
// preview page carries the read-only guarantee now.
const recommendationPreview = read('apps/web/src/pages/admin/recommendations/preview.astro');

describe('Slice 07-A admin trust centre P0', () => {
  it('constrains status vocabulary to the approved eight values', () => {
    expect(ADMIN_TRUST_STATUSES).toEqual([
      'Live', 'Ready', 'No data yet', 'Protected', 'Disabled',
      'Dormant', 'Action required', 'Review recommended',
    ]);
  });

  it('rejects status labels outside the approved vocabulary', () => {
    expect(isAdminTrustStatus('Live')).toBe(true);
    expect(isAdminTrustStatus('Operational')).toBe(false);
    expect(isAdminTrustStatus('Active')).toBe(false);
  });

  it('maps statuses to consistent operator-facing tones', () => {
    expect(adminStatusTone('Live')).toBe('success');
    expect(adminStatusTone('Protected')).toBe('info');
    expect(adminStatusTone('Dormant')).toBe('neutral');
    expect(adminStatusTone('Disabled')).toBe('danger');
    expect(adminStatusTone('Action required')).toBe('warning');
  });

  it('defines exactly the required trust-centre module families once each', () => {
    const ids = ADMIN_TRUST_MODULES.map((module) => module.id);
    expect(ids).toEqual(['products', 'orders', 'recommendations', 'measurement', 'support', 'legal', 'loyalty']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every module a title, description, status, action and next step', () => {
    for (const module of ADMIN_TRUST_MODULES) {
      expect(module.title.trim()).not.toBe('');
      expect(module.description.trim()).not.toBe('');
      expect(isAdminTrustStatus(module.status)).toBe(true);
      expect(module.actionLabel.trim()).not.toBe('');
      expect(module.nextStep.trim()).not.toBe('');
    }
  });

  it('requires a reason for every disabled module action', () => {
    const disabled = ADMIN_TRUST_MODULES.filter((module) => module.actionDisabled);
    expect(disabled.every((module) => Boolean(module.disabledReason?.trim()))).toBe(true);
  });

  it('requires a safe href for every enabled module action', () => {
    const enabled = ADMIN_TRUST_MODULES.filter((module) => !module.actionDisabled);
    expect(enabled.every((module) => module.href?.startsWith('/'))).toBe(true);
  });

  it('describes products as live catalogue-truth work without fake counts', () => {
    const products = ADMIN_TRUST_MODULES.find((module) => module.id === 'products');
    expect(products).toMatchObject({ status: 'Live', href: '/admin/products' });
    expect(`${products?.description} ${products?.nextStep}`).toMatch(/catalogue|images|prices|availability/i);
  });

  it('keeps orders protected and explicitly avoids paid-state mutation', () => {
    const orders = ADMIN_TRUST_MODULES.find((module) => module.id === 'orders');
    expect(orders).toMatchObject({ status: 'Protected', href: '/admin/orders' });
    expect(orders?.safetyNote).toContain('does not mark orders paid');
  });

  it('represents recommendations as a live read-only preview', () => {
    const recommendations = ADMIN_TRUST_MODULES.find((module) => module.id === 'recommendations');
    expect(recommendations).toMatchObject({ status: 'Live', href: '/admin/recommendations/preview' });
    expect(recommendations?.safetyNote).toContain('read-only');
  });

  it('keeps Measurement protected without implying provider activation', () => {
    const measurementModule = ADMIN_TRUST_MODULES.find((module) => module.id === 'measurement');
    expect(measurementModule).toMatchObject({ status: 'Protected', href: '/admin/measurement-control-tower' });
    expect(measurementModule?.safetyNote).toContain('does not activate');
  });

  it('presents support operations as a live, protected first-party queue', () => {
    // The first-party support capability has a mounted API and an admin page, so
    // presenting it as unconfigured misreported a working module as broken.
    const support = ADMIN_TRUST_MODULES.find((module) => module.id === 'support');
    expect(support).toMatchObject({ status: 'Protected', href: '/admin/support' });
    expect(support?.actionDisabled).toBeFalsy();
    expect(support?.safetyNote).toContain('without them');
  });

  it('distinguishes live interim legal routes from final legal approval', () => {
    const legal = ADMIN_TRUST_MODULES.find((module) => module.id === 'legal');
    expect(legal).toMatchObject({ status: 'Live', href: '/terms' });
    expect(legal?.safetyNote).toContain('does not mean lawyer-approved final wording');
  });

  it('presents loyalty as an operational ledger whose programme is dormant', () => {
    // Service availability and business activation are separate: the ledger works
    // and is auditable, but no value is issued until an operator approves a policy.
    const loyalty = ADMIN_TRUST_MODULES.find((module) => module.id === 'loyalty');
    expect(loyalty).toMatchObject({ status: 'Dormant', href: '/admin/loyalty' });
    expect(loyalty?.actionDisabled).toBeFalsy();
    expect(loyalty?.safetyNote).toContain('no value is issued until an operator approves');
  });

  it('renders all ten required readiness topics without invented metrics', () => {
    expect(ADMIN_READINESS_ITEMS).toHaveLength(10);
    const ids = ADMIN_READINESS_ITEMS.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining([
      'storefront', 'discovery', 'pdp', 'checkout', 'support', 'legal',
      'recommendations', 'admin-access', 'providers', 'loyalty',
    ]));
  });

  it('keeps provider sends disabled and checkout truth protected', () => {
    expect(ADMIN_READINESS_ITEMS.find((item) => item.id === 'providers')?.status).toBe('Disabled');
    expect(ADMIN_READINESS_ITEMS.find((item) => item.id === 'checkout')?.status).toBe('Protected');
  });

  it('renders module title, description, status and next-step content', () => {
    expect(moduleCard).toContain('{module.title}');
    expect(moduleCard).toContain('{module.description}');
    expect(moduleCard).toContain('{module.status}');
    expect(moduleCard).toContain('Next best step');
  });

  it('renders an accessible disabled-action reason', () => {
    expect(moduleCard).toContain('disabled');
    expect(moduleCard).toContain('aria-describedby={disabledReasonId}');
    expect(moduleCard).toContain('Why disabled:');
  });

  it('makes empty states answer what, why and next safe step', () => {
    expect(emptyState).toContain('What this is');
    expect(emptyState).toContain('Why this state appears');
    expect(emptyState).toContain('Next safe step');
    expect(emptyState).toContain('access-denied');
  });

  it('states that the readiness checklist does not query or activate providers', () => {
    expect(readiness).toContain('does not query providers, read credentials or activate a service');
  });

  it('keeps the central dashboard protected for logged-out requests', () => {
    expect(dashboard).toContain('const token = readSessionToken(Astro.request)');
    expect(dashboard).toContain('if (!token)');
    expect(dashboard).toContain('Astro.redirect("/admin/login?returnTo=/admin", 303)');
  });

  it('renders modules from computed readiness, not a static table, and hides the API base', () => {
    expect(dashboard).toContain('GoldPlus Admin Trust Centre');
    // Runtime status must come from the readiness service. Rendering the static
    // ADMIN_TRUST_MODULES array here is the defect this programme removed: a card
    // could claim "Live" with no relationship to whether anything worked.
    expect(dashboard).not.toContain('ADMIN_TRUST_MODULES.map');
    expect(dashboard).toContain('fetchModuleReadiness');
    expect(dashboard).toContain('summary.modules.map');
    // A readiness failure must render a truthful failure state, never static cards.
    expect(dashboard).toContain('ControlCentreFailure');
    expect(dashboard).toContain('AdminReadinessChecklist');
    expect(dashboard).not.toContain("apiBase || 'No API Base Key'");
    expect(dashboard).not.toContain('No API Base Key');
  });

  it('provides RBAC-aware denied copy without changing roles', () => {
    expect(dashboard).toContain('You do not have access to admin service data');
    expect(dashboard).toContain('ask an owner or admin for the correct role');
    expect(dashboard).toContain('does not grant permissions');
  });

  it('protects Measurement explicitly and provides safe denied, error and no-data states', () => {
    expect(measurement).toContain("readSessionToken(Astro.request)");
    expect(measurement).toContain("Astro.redirect('/admin/login?returnTo=/admin/measurement-control-tower', 303)");
    expect(measurement).toContain('You do not have access to the Measurement Control Tower');
    expect(measurement).toContain('Measurement readiness could not be loaded');
    expect(measurement).toContain('No measurement readiness data yet');
  });

  it('preserves read-only recommendations and forbids unsafe operator actions or fake metrics', () => {
    const touched = `${dashboard}\n${moduleCard}\n${emptyState}\n${readiness}\n${measurement}\n${recommendationPreview}`;
    expect(recommendationPreview).toContain('nothing saved');
    expect(touched).not.toMatch(/Mark as paid|Activate provider|Send to customer|Send WhatsApp|Customer count|Revenue today|Orders today/);
    expect(touched).not.toMatch(/api[_-]?key|client[_-]?secret|password\s*[:=]/i);
  });
});
