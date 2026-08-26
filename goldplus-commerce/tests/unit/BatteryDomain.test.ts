import { describe, expect, it } from 'vitest';
import { analyseSourceLine, batteryCodeCandidates, batterySku, knownConflict, looksLikeBatteryCode, looksLikeRouterBattery, normaliseBatteryCode } from '../../apps/api/src/domain/batteries/BatteryCodes';
import { legacyConfidence, publicFitState, transitionClaim, isMaterialEdit } from '../../apps/api/src/domain/batteries/CompatibilityWorkflow';
import { assessReadiness, transitionBattery } from '../../apps/api/src/domain/batteries/BatteryReadiness';
import { isExactTier, rankSearch } from '../../apps/api/src/domain/batteries/FinderRanking';
import { countBlockers, planMovement, receiptBlockers } from '../../apps/api/src/domain/batteries/InventoryLedger';
import { deviceIdentitySlug, mergeImpact, orderBrands, orderModels } from '../../apps/api/src/domain/batteries/DeviceHierarchy';
import { STOREFRONT_PRICE_FLOOR_UGX, validateBatteryFinderConfig, DEFAULT_BATTERY_FINDER_CONFIG } from '../../packages/shared/src/batteries';

describe('battery codes: normalisation and resolution forms', () => {
  it('collapses case, spaces and hyphens without changing the displayed code', () => {
    expect(normaliseBatteryCode('BL-49FT')).toBe('BL49FT');
    expect(normaliseBatteryCode('bl 49ft')).toBe('BL49FT');
    expect(normaliseBatteryCode('BL49FT')).toBe('BL49FT');
    expect(normaliseBatteryCode('GP-49FT')).toBe('GP49FT');
  });

  it('resolves the shop label, the bare code and the full code to the same candidate set', () => {
    for (const typed of ['GP-49FT', 'BL-49FT', '49FT', 'BL49FT', 'bl 49ft']) {
      expect(batteryCodeCandidates(typed), typed).toContain('BL49FT');
    }
    expect(batteryCodeCandidates('GP-49FT')).toEqual(['GP49FT', '49FT', 'BL49FT']);
  });

  it('recognises the battery code families in the source list', () => {
    for (const code of ['BL-49FT', '49FT', 'BLP727', 'EB-BA505ABU', 'HQ-50S', 'WT140', 'BL-4U', 'BL-5C', 'DC3650']) expect(looksLikeBatteryCode(code), code).toBe(true);
    for (const notCode of ['Spark 7', 'IPHONE', 'NOTE 4', 'OPPO']) expect(looksLikeBatteryCode(notCode), notCode).toBe(false);
  });

  it('classifies a single reference, a phone name and a code with device words', () => {
    expect(analyseSourceLine('GP-49FT').kind).toBe('CODE');
    expect(analyseSourceLine('GP-IP 11 PRO').kind).toBe('DEVICE_NAMED');
    expect(analyseSourceLine('GP-NOKIA C1').kind).toBe('DEVICE_NAMED');
    expect(analyseSourceLine('GP-32AT CX').kind).toBe('CODE_PLUS_DEVICE');
    expect(analyseSourceLine('GP-OPPO F9(BL-681)').codes).toContain('BL681');
  });

  it('builds a bounded SKU from the code', () => {
    expect(batterySku('BL-49FT')).toBe('GP-BAT-BL49FT');
  });

  it('routes MiFi labels out of phone batteries', () => {
    expect(looksLikeRouterBattery('GP- DC3650 WIFI BIG')).toBe(true);
    expect(looksLikeRouterBattery('GP-4G WIFI SMALL')).toBe(true);
    expect(looksLikeRouterBattery('GP-49FT')).toBe(false);
  });

  it('names the six known conflicts', () => {
    for (const raw of ['GP-NOTE 4 EDGE', 'GP-NOTE 4 EDGE PLUS', 'GP-39LT9 SPARK 4/A56', 'GP-OPPO A57', 'GP-A03/A04', 'GP-49FX POP5/SMART 6 AND 7']) {
      expect(knownConflict(raw), raw).toBeTruthy();
    }
    expect(knownConflict('GP-49FT')).toBeNull();
  });
});

describe('compatibility workflow: maker/checker and publication', () => {
  const base = { workflowStatus: 'DRAFT' as const, evidenceStatus: 'SUPPLIER_LISTED' as const, createdBy: 'maker', submittedBy: null, reviewedBy: null, publicCondition: null, deviceStatus: 'ACTIVE' };

  it('a draft is submitted, then the maker cannot verify it', () => {
    const submitted = transitionClaim(base, 'SUBMIT', 'maker');
    expect(submitted).toEqual({ ok: true, next: 'REVIEW', evidenceStatus: 'SUPPLIER_LISTED' });
    const selfVerify = transitionClaim({ ...base, workflowStatus: 'REVIEW', submittedBy: 'maker' }, 'VERIFY', 'maker', { evidenceStatus: 'PACKAGE_VERIFIED' });
    expect(selfVerify.ok).toBe(false);
    if (!selfVerify.ok) expect(selfVerify.code).toBe('MAKER_CHECKER');
  });

  it('a verifier needs real evidence; a supplier listing alone stays awaiting verification', () => {
    const weak = transitionClaim({ ...base, workflowStatus: 'REVIEW', submittedBy: 'maker' }, 'VERIFY', 'checker');
    expect(weak.ok).toBe(false);
    const strong = transitionClaim({ ...base, workflowStatus: 'REVIEW', submittedBy: 'maker' }, 'VERIFY', 'checker', { evidenceStatus: 'FIT_TESTED' });
    expect(strong).toEqual({ ok: true, next: 'READY', evidenceStatus: 'FIT_TESTED' });
  });

  it('a conditional verdict must state its condition', () => {
    const noCondition = transitionClaim({ ...base, workflowStatus: 'REVIEW', submittedBy: 'maker' }, 'VERIFY', 'checker', { evidenceStatus: 'CONDITIONAL' });
    expect(noCondition.ok).toBe(false);
    const withCondition = transitionClaim({ ...base, workflowStatus: 'REVIEW', submittedBy: 'maker' }, 'VERIFY', 'checker', { evidenceStatus: 'CONDITIONAL', publicCondition: 'Only the 2021 revision with the 4-pin flex.' });
    expect(withCondition.ok).toBe(true);
  });

  it('only a ready claim publishes, a rejected one never does, and archive keeps history', () => {
    expect(transitionClaim({ ...base, workflowStatus: 'DRAFT' }, 'PUBLISH', 'publisher').ok).toBe(false);
    expect(transitionClaim({ ...base, workflowStatus: 'READY', evidenceStatus: 'FIT_TESTED', reviewedBy: 'checker' }, 'PUBLISH', 'publisher')).toEqual({ ok: true, next: 'ACTIVE', evidenceStatus: 'FIT_TESTED' });
    const rejected = transitionClaim({ ...base, workflowStatus: 'REVIEW', submittedBy: 'maker' }, 'REJECT', 'checker', { reason: 'Wrong flex.' });
    expect(rejected).toEqual({ ok: true, next: 'ARCHIVED', evidenceStatus: 'REJECTED' });
    expect(transitionClaim({ ...base, workflowStatus: 'ARCHIVED', evidenceStatus: 'REJECTED' }, 'RESTORE', 'publisher').ok).toBe(false);
    expect(transitionClaim({ ...base, workflowStatus: 'ARCHIVED', evidenceStatus: 'FIT_TESTED', reviewedBy: 'checker' }, 'RESTORE', 'publisher')).toEqual({ ok: true, next: 'READY', evidenceStatus: 'FIT_TESTED' });
  });

  it('an archived or merged device blocks submission and publication', () => {
    expect(transitionClaim({ ...base, deviceStatus: 'MERGED' }, 'SUBMIT', 'maker').ok).toBe(false);
    expect(transitionClaim({ ...base, workflowStatus: 'READY', evidenceStatus: 'FIT_TESTED', deviceStatus: 'ARCHIVED' }, 'PUBLISH', 'publisher').ok).toBe(false);
  });

  it('material edits reopen a claim; notes do not', () => {
    expect(isMaterialEdit(['notes'])).toBe(false);
    expect(isMaterialEdit(['evidenceStatus'])).toBe(true);
  });

  it('derives the public state from evidence, publication and stock, never from a stored flag', () => {
    const live = { workflowStatus: 'ACTIVE' as const, batteryLifecycle: 'ACTIVE', productApproved: true, productActive: true, showAwaitingVerification: true };
    expect(publicFitState({ ...live, evidenceStatus: 'FIT_TESTED', stockQuantity: 3 })).toBe('VERIFIED_IN_STOCK');
    expect(publicFitState({ ...live, evidenceStatus: 'VERIFIED_EXACT', stockQuantity: 0 })).toBe('VERIFIED_OUT_OF_STOCK');
    expect(publicFitState({ ...live, evidenceStatus: 'CONDITIONAL', stockQuantity: 5 })).toBe('CONDITIONAL');
    expect(publicFitState({ ...live, evidenceStatus: 'SUPPLIER_LISTED', stockQuantity: 5 })).toBe('AWAITING_VERIFICATION');
    expect(publicFitState({ ...live, evidenceStatus: 'SUPPLIER_LISTED', stockQuantity: 5, showAwaitingVerification: false })).toBeNull();
    expect(publicFitState({ ...live, evidenceStatus: 'REJECTED', stockQuantity: 5 })).toBeNull();
    expect(publicFitState({ ...live, workflowStatus: 'READY', evidenceStatus: 'FIT_TESTED', stockQuantity: 5 })).toBeNull();
    expect(publicFitState({ ...live, batteryLifecycle: 'DRAFT', evidenceStatus: 'FIT_TESTED', stockQuantity: 5 })).toBeNull();
    expect(publicFitState({ ...live, productApproved: false, evidenceStatus: 'FIT_TESTED', stockQuantity: 5 })).toBeNull();
  });

  it('keeps the 0070 confidence column truthful', () => {
    expect(legacyConfidence('FIT_TESTED', 'ACTIVE')).toBe('verified');
    expect(legacyConfidence('FIT_TESTED', 'DRAFT')).toBe('declared');
    expect(legacyConfidence('SUPPLIER_LISTED', 'ACTIVE')).toBe('declared');
    expect(legacyConfidence('CONDITIONAL', 'READY')).toBe('inferred');
  });

  it('archiving a verified claim does not discard the verification, so it can be restored', () => {
    // Regression: archiving used to clear verifiedBy/verifiedAt because the
    // projected confidence was no longer 'verified'. Restoring then wrote
    // confidence='verified' with no actor and the 0070 evidence CHECK rejected
    // it, so a live fit could be archived but never brought back.
    const verified = { ...base, workflowStatus: 'ACTIVE' as const, evidenceStatus: 'FIT_TESTED' as const, reviewedBy: 'checker' };
    const archived = transitionClaim(verified, 'ARCHIVE', 'publisher');
    expect(archived).toEqual({ ok: true, next: 'ARCHIVED', evidenceStatus: 'FIT_TESTED' });
    const restored = transitionClaim({ ...verified, workflowStatus: 'ARCHIVED' }, 'RESTORE', 'publisher');
    expect(restored).toEqual({ ok: true, next: 'READY', evidenceStatus: 'FIT_TESTED' });
    // The projection is only 'verified' where the evidence trail survives.
    expect(legacyConfidence('FIT_TESTED', 'READY')).toBe('verified');
    expect(legacyConfidence('FIT_TESTED', 'ARCHIVED')).toBe('declared');
  });
});

describe('battery readiness: every blocker says why', () => {
  const ready = {
    canonicalCode: 'BL-49FT', codeStatus: 'CONFIRMED', verificationStatus: 'VERIFIED', lifecycleStatus: 'READY', hasPrimaryImage: true, priceUgx: 150_000,
    productApproved: true, stockQuantity: 4, movementCount: 1, capacityMah: 5000, nominalVoltageMv: 3850, barcode: '6252801558806', warrantyMonths: 12, publicNotes: 'Fits the KF6n only.',
    aliasConflicts: [] as string[], mappings: [{ workflowStatus: 'READY', evidenceStatus: 'FIT_TESTED', deviceStatus: 'ACTIVE' }],
  };

  it('a complete battery is ready with no blockers', () => {
    const report = assessReadiness(ready);
    expect(report.ready).toBe(true);
    expect(report.blockers).toEqual([]);
  });

  it('names each missing fact', () => {
    const report = assessReadiness({ ...ready, codeStatus: 'DEVICE_NAMED', canonicalCode: 'IP X', hasPrimaryImage: false, priceUgx: 0, movementCount: 0, verificationStatus: 'UNVERIFIED', capacityMah: null, mappings: [], aliasConflicts: ['BL49FT'] });
    const codes = report.blockers.map((b) => b.code);
    expect(codes).toEqual(expect.arrayContaining(['NO_CANONICAL_CODE', 'ALIAS_CONFLICT', 'NO_PRIMARY_IMAGE', 'NO_PRICE', 'NO_STOCK_LINKAGE', 'BATTERY_UNVERIFIED', 'MISSING_REQUIRED_SPECS', 'NO_VERIFIED_COMPATIBILITY']));
    expect(report.blockers.find((b) => b.code === 'NO_CANONICAL_CODE')?.message).toMatch(/phone name/);
  });

  it('holds a compound code and enforces the storefront price floor', () => {
    expect(assessReadiness({ ...ready, canonicalCode: 'BL-49CI/CT' }).blockers.map((b) => b.code)).toContain('UNRESOLVED_COMPOUND_CODE');
    const cheap = assessReadiness({ ...ready, priceUgx: STOREFRONT_PRICE_FLOOR_UGX - 1 });
    expect(cheap.blockers.map((b) => b.code)).toContain('PRICE_BELOW_FLOOR');
  });

  it('a supplier listing alone is not verified compatibility; an archived device blocks', () => {
    expect(assessReadiness({ ...ready, mappings: [{ workflowStatus: 'ACTIVE', evidenceStatus: 'SUPPLIER_LISTED', deviceStatus: 'ACTIVE' }] }).blockers.map((b) => b.code)).toContain('NO_VERIFIED_COMPATIBILITY');
    expect(assessReadiness({ ...ready, mappings: [{ workflowStatus: 'ACTIVE', evidenceStatus: 'FIT_TESTED', deviceStatus: 'ARCHIVED' }] }).blockers.map((b) => b.code)).toContain('INVALID_DEVICE_MAPPING');
  });

  it('publication follows readiness; a draft cannot be published directly', () => {
    const report = assessReadiness(ready);
    expect(transitionBattery('DRAFT', 'PUBLISH', report).ok).toBe(false);
    expect(transitionBattery('READY', 'PUBLISH', report)).toEqual({ ok: true, next: 'ACTIVE' });
    const blocked = assessReadiness({ ...ready, priceUgx: 0 });
    const attempt = transitionBattery('READY', 'PUBLISH', blocked);
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.message).toMatch(/No retail price/);
    expect(transitionBattery('ACTIVE', 'ARCHIVE', report)).toEqual({ ok: true, next: 'ARCHIVED' });
    expect(transitionBattery('ARCHIVED', 'RESTORE', report)).toEqual({ ok: true, next: 'DRAFT' });
  });
});

describe('finder ranking: exact resolves, similar only suggests', () => {
  const devices = [
    { id: 'd-spark7', brandNormalised: 'tecno', modelNormalised: 'spark 7', modelNumberNormalised: 'kf6n', variantNormalised: null, aliasesNormalised: ['spark seven'], brandAliasesNormalised: ['techno'], status: 'ACTIVE' },
    { id: 'd-spark7go', brandNormalised: 'tecno', modelNormalised: 'spark 7 go', modelNumberNormalised: 'kf6m', variantNormalised: null, aliasesNormalised: [], brandAliasesNormalised: ['techno'], status: 'ACTIVE' },
    { id: 'd-a32', brandNormalised: 'samsung', modelNormalised: 'galaxy a32 5g', modelNumberNormalised: 'sm a326b', variantNormalised: null, aliasesNormalised: ['a32 5g'], brandAliasesNormalised: [], status: 'ACTIVE' },
    { id: 'd-old', brandNormalised: 'tecno', modelNormalised: 'spark 7', modelNumberNormalised: 'kf6', variantNormalised: null, aliasesNormalised: [], brandAliasesNormalised: [], status: 'ARCHIVED' },
  ];
  const batteries = [
    { productId: 'b-49ft', canonicalCodeNormalised: 'BL49FT', supplierCodeNormalised: null, barcode: '6252801558806', aliasesNormalised: ['BL49FT', 'GP49FT', '49FT'], lifecycleStatus: 'ACTIVE' },
    { productId: 'b-49jt', canonicalCodeNormalised: 'BL49JT', supplierCodeNormalised: 'SUP49JT', barcode: null, aliasesNormalised: ['BL49JT'], lifecycleStatus: 'DRAFT' },
  ];

  it('resolves a barcode, a code, an alias and the shop label to the battery', () => {
    for (const q of ['6252801558806', 'BL-49FT', 'bl 49ft', '49FT', 'GP-49FT']) {
      const r = rankSearch({ query: q, devices, batteries });
      expect(r[0], q).toMatchObject({ kind: 'BATTERY', productId: 'b-49ft' });
      expect(isExactTier(r[0].tier)).toBe(true);
    }
  });

  it('resolves an exact model number and an exact marketing name, brand-qualified or not', () => {
    expect(rankSearch({ query: 'KF6n', devices, batteries })[0]).toMatchObject({ kind: 'DEVICE', deviceId: 'd-spark7', tier: 3 });
    expect(rankSearch({ query: 'Tecno Spark 7', devices, batteries })[0]).toMatchObject({ kind: 'DEVICE', deviceId: 'd-spark7', tier: 4 });
    expect(rankSearch({ query: 'Techno Spark 7 Go', devices, batteries })[0]).toMatchObject({ kind: 'DEVICE', deviceId: 'd-spark7go' });
    expect(rankSearch({ query: 'SM-A326B', devices, batteries })[0]).toMatchObject({ kind: 'DEVICE', deviceId: 'd-a32' });
  });

  it('a prefix or a fuzzy hit is a suggestion, never an exact result', () => {
    const r = rankSearch({ query: 'Spark', devices, batteries });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((m) => !isExactTier(m.tier))).toBe(true);
    const fuzzy = rankSearch({ query: 'sprak 7', devices, batteries, fuzzyDevices: [{ id: 'd-spark7', score: 0.6 }] });
    expect(fuzzy[0]).toMatchObject({ kind: 'DEVICE', deviceId: 'd-spark7', tier: 7 });
  });

  it('ignores archived devices and returns nothing for nonsense', () => {
    expect(rankSearch({ query: 'KF6', devices, batteries }).some((m) => m.kind === 'DEVICE' && m.deviceId === 'd-old')).toBe(false);
    expect(rankSearch({ query: 'zzzz', devices, batteries })).toEqual([]);
  });
});

describe('inventory ledger rules', () => {
  it('turns requests into signed deltas and refuses the wrong sign', () => {
    expect(planMovement({ movementType: 'RECEIPT', quantity: 10, reason: 'Invoice 55', supplierName: 'Acme' }, 3)).toEqual({ ok: true, delta: 10, reason: 'Invoice 55' });
    expect(planMovement({ movementType: 'DAMAGED', quantity: 2, reason: 'Swollen cell' }, 3)).toEqual({ ok: true, delta: -2, reason: 'Swollen cell' });
    expect(planMovement({ movementType: 'COUNT', quantity: 7, reason: 'Cycle count' }, 3)).toEqual({ ok: true, delta: 4, reason: 'Cycle count' });
    expect(planMovement({ movementType: 'RECEIPT', quantity: 10, reason: 'x' }, 3).ok).toBe(false);
    expect(planMovement({ movementType: 'RECEIPT', quantity: 10, reason: '', supplierName: 'Acme' }, 3).ok).toBe(false);
    expect(planMovement({ movementType: 'DAMAGED', quantity: 0, reason: 'x' }, 3).ok).toBe(false);
    expect(planMovement({ movementType: 'ADJUSTMENT', quantity: 1.5, reason: 'x' }, 3).ok).toBe(false);
  });

  it('a receipt applies only when every line resolves; a count needs a reason for every difference', () => {
    expect(receiptBlockers([{ productId: 'p', scannedCode: 'BL-49FT', quantity: 5, unitCostUgx: null, matchKind: 'EXISTING' }])).toEqual([]);
    expect(receiptBlockers([{ productId: null, scannedCode: 'XX', quantity: 5, unitCostUgx: null, matchKind: 'AMBIGUOUS' }])[0]).toMatch(/more than one/);
    expect(receiptBlockers([{ productId: null, scannedCode: 'NEW1', quantity: 5, unitCostUgx: null, matchKind: 'NEW' }])[0]).toMatch(/new battery/);
    expect(countBlockers([{ productId: 'p', systemQuantity: 4, countedQuantity: 4, reason: null }])).toEqual([]);
    expect(countBlockers([{ productId: 'p', systemQuantity: 4, countedQuantity: 2, reason: null }])[0]).toMatch(/reason is required/);
  });
});

describe('device hierarchy: ordering and merge impact', () => {
  it('orders featured brands first, then coverage and demand, then alphabetically, unless the admin chose otherwise', () => {
    const brands = [
      { id: 'n', name: 'Nokia', isFeatured: false, displayOrder: 0, verifiedFits: 0, demandCount: 0 },
      { id: 't', name: 'TECNO', isFeatured: false, displayOrder: 0, verifiedFits: 12, demandCount: 40 },
      { id: 's', name: 'Samsung', isFeatured: true, displayOrder: 2, verifiedFits: 1, demandCount: 0 },
      { id: 'a', name: 'Apple', isFeatured: true, displayOrder: 1, verifiedFits: 0, demandCount: 0 },
      { id: 'i', name: 'Infinix', isFeatured: false, displayOrder: 0, verifiedFits: 0, demandCount: 0 },
    ];
    expect(orderBrands(brands, 'FEATURED_THEN_COVERAGE').map((b) => b.id)).toEqual(['a', 's', 't', 'i', 'n']);
    expect(orderBrands(brands, 'ALPHABETICAL').map((b) => b.id)).toEqual(['a', 'i', 'n', 's', 't']);
  });

  it('orders models featured first, then newer, then demand, then name', () => {
    const models = [
      { id: 'x', model: 'Spark 7', modelNumber: 'KF6n', displayOrder: 0, releaseYear: 2021, demandCount: 0 },
      { id: 'y', model: 'Spark 8', modelNumber: null, displayOrder: 0, releaseYear: 2021, demandCount: 5 },
      { id: 'z', model: 'Spark 5', modelNumber: null, displayOrder: 1, releaseYear: 2020, demandCount: 0 },
      { id: 'w', model: 'Spark 10', modelNumber: null, displayOrder: 0, releaseYear: null, demandCount: 9 },
    ];
    expect(orderModels(models).map((m) => m.id)).toEqual(['z', 'y', 'x', 'w']);
  });

  it('separates the marketing name from the exact model number in the slug', () => {
    expect(deviceIdentitySlug({ brand: 'Samsung', model: 'Galaxy A32 5G', modelNumber: 'SM-A326B' })).toBe('samsung-galaxy-a32-5g-sm-a326b');
  });

  it('previews a merge with the facts and blocks the unsafe ones', () => {
    const impact = mergeImpact({ source: { id: 'a', aliases: ['a32'], model: 'Galaxy A32', status: 'ACTIVE' }, target: { id: 'b', status: 'ACTIVE' }, sourceMappingDeviceProducts: ['p1', 'p2'], targetMappingDeviceProducts: ['p2'], openRequests: 1 });
    expect(impact).toMatchObject({ mappingsToMove: 1, mappingsAlreadyOnTarget: 1, requestsToRepoint: 1, blocked: null });
    expect(impact.aliasesToCarry).toEqual(['Galaxy A32', 'a32']);
    expect(mergeImpact({ source: { id: 'a', aliases: [], model: 'x', status: 'ACTIVE' }, target: { id: 'a', status: 'ACTIVE' }, sourceMappingDeviceProducts: [], targetMappingDeviceProducts: [], openRequests: 0 }).blocked).toMatch(/itself/);
    expect(mergeImpact({ source: { id: 'a', aliases: [], model: 'x', status: 'ACTIVE' }, target: { id: 'b', status: 'ARCHIVED' }, sourceMappingDeviceProducts: [], targetMappingDeviceProducts: [], openRequests: 0 }).blocked).toMatch(/active/);
  });
});

describe('finder config is admin-owned and validated', () => {
  it('accepts the default and refuses dashes, blanks and bad modes', () => {
    expect(validateBatteryFinderConfig(DEFAULT_BATTERY_FINDER_CONFIG).ok).toBe(true);
    const bad = validateBatteryFinderConfig({ ...DEFAULT_BATTERY_FINDER_CONFIG, headline: 'Batteries — find yours', brandOrderMode: 'RANDOM', noResultBody: '' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/dash/);
  });

  it('has no dashes in the default customer copy', () => {
    for (const [k, v] of Object.entries(DEFAULT_BATTERY_FINDER_CONFIG)) if (typeof v === 'string') expect(v, k).not.toMatch(/[–—]/);
  });
});
