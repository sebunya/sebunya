import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { ApiResponse, BATTERY_CATEGORIES, BATTERY_CHEMISTRIES, BATTERY_ALIAS_TYPES, COMPAT_EVIDENCE_STATUSES, EVIDENCE_KINDS, MOVEMENT_TYPES, PERMISSIONS } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { BatteryOperationError } from '../../../../application/use-cases/batteries/BatteryOperationError';

/**
 * Batteries admin surface: catalogue, aliases, evidence, device hierarchy,
 * compatibility workflow, stock ledger, demand queue and finder settings.
 * Thin transport: every rule lives in the battery use cases.
 *
 * audit-exempt: every mutation is audited inside the battery use cases through
 * CreateAuditLogUseCase (before/after, actor, reason).
 */
const routes = new Hono();
routes.use('*', authMiddleware);

type Ctx = Context;
const param = (c: Ctx, name: string): string => c.req.param(name) ?? '';
const ok = <T>(c: Ctx, data: T, status = 200) => c.json({ success: true, data } satisfies ApiResponse<T>, status as 200);
const bad = (c: Ctx, code: string, message: string, status = 400, details?: unknown) =>
  c.json({ success: false, error: { code, message, details } } satisfies ApiResponse<never>, status as 400);
const actor = (c: Ctx): string => (c.get('user') as { id: string }).id;
const has = (c: Ctx, permission: string): boolean => ((c.get('user') as { permissions?: string[] }).permissions ?? []).includes(permission);
const registry = () => Registry.getInstance();

async function run<T>(c: Ctx, fn: () => Promise<T>, status = 200) {
  try {
    return ok(c, await fn(), status);
  } catch (error) {
    if (error instanceof BatteryOperationError) return bad(c, error.code, error.message, error.status, error.details);
    throw error;
  }
}

async function body<T extends z.ZodTypeAny>(c: Ctx, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return { ok: false, response: bad(c, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.', 400, parsed.error.issues) };
  return { ok: true, data: parsed.data };
}

const uuid = z.string().uuid();
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalInt = z.number().int().nullable().optional();
const optionalNum = z.number().nullable().optional();

// ---------------------------------------------------------------- catalogue
const profileFields = {
  codeStatus: z.enum(['CONFIRMED', 'PROVISIONAL', 'DEVICE_NAMED', 'MISSING']).optional(),
  supplierCode: nullableText(120),
  barcode: nullableText(64),
  batteryCategory: z.enum(BATTERY_CATEGORIES).optional(),
  chemistry: z.enum(BATTERY_CHEMISTRIES).nullable().optional(),
  nominalVoltageMv: optionalInt,
  capacityMah: optionalInt,
  wattHours: optionalNum,
  lengthMm: optionalNum,
  widthMm: optionalNum,
  thicknessMm: optionalNum,
  weightG: optionalNum,
  connectorNotes: nullableText(300),
  warrantyMonths: optionalInt,
  supplierName: nullableText(160),
  supplierReference: nullableText(160),
  packagingNotes: nullableText(5000),
  safetyNotes: nullableText(5000),
  internalNotes: nullableText(5000),
  publicNotes: nullableText(5000),
};
const createBattery = z.object({
  canonicalCode: z.string().trim().min(1).max(80),
  name: nullableText(255),
  brand: nullableText(60),
  shortDescription: nullableText(500),
  longDescription: nullableText(5000),
  priceUgx: z.number().int().min(0).nullable().optional(),
  aliases: z.array(z.object({ alias: z.string().trim().min(1).max(120), aliasType: z.enum(BATTERY_ALIAS_TYPES).optional(), source: nullableText(200) })).max(30).optional(),
  lifecycleStatus: z.enum(['DRAFT', 'REVIEW']).optional(),
  sourceReference: nullableText(200),
  ...profileFields,
});
const updateBattery = z.object({
  canonicalCode: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(255).optional(),
  shortDescription: z.string().max(500).optional(),
  longDescription: z.string().max(5000).optional(),
  priceUgx: z.number().int().min(0).nullable().optional(),
  ...profileFields,
});

routes.get('/dashboard', requirePermissions([PERMISSIONS.BATTERIES_READ]), (c) => run(c, () => registry().batteryCatalogueUseCases.dashboard()));

routes.get('/catalogue', requirePermissions([PERMISSIONS.BATTERIES_READ]), (c) => {
  const q = c.req.query();
  return run(c, () => registry().batteryCatalogueUseCases.list({
    q: q.q || undefined,
    status: (q.status as never) || undefined,
    category: (q.category as never) || undefined,
    missing: (q.missing as never) || undefined,
    verification: (q.verification as never) || undefined,
    limit: Number(q.limit) || undefined,
  }));
});

routes.post('/catalogue/lookup', requirePermissions([PERMISSIONS.BATTERIES_READ]), async (c) => {
  const b = await body(c, z.object({ query: z.string().trim().min(1).max(120) }));
  if (!b.ok) return b.response;
  return run(c, () => registry().batteryCatalogueUseCases.lookup(b.data.query));
});

routes.post('/catalogue', requirePermissions([PERMISSIONS.BATTERIES_CATALOGUE_MANAGE]), async (c) => {
  const b = await body(c, createBattery);
  if (!b.ok) return b.response;
  return run(c, () => registry().batteryCatalogueUseCases.create({ ...b.data, actorId: actor(c) }), 201);
});

routes.post('/catalogue/bulk', requirePermissions([PERMISSIONS.BATTERIES_READ]), async (c) => {
  const b = await body(c, z.object({ productIds: z.array(uuid).min(1).max(100), action: z.enum(['SUBMIT_REVIEW', 'MARK_READY', 'PUBLISH', 'UNPUBLISH', 'ARCHIVE', 'RESTORE', 'REOPEN']) }));
  if (!b.ok) return b.response;
  const needs = ['PUBLISH', 'UNPUBLISH', 'ARCHIVE', 'RESTORE'].includes(b.data.action) ? PERMISSIONS.BATTERIES_PUBLISH : PERMISSIONS.BATTERIES_CATALOGUE_MANAGE;
  if (!has(c, needs)) return bad(c, 'FORBIDDEN', 'You do not have the right to perform this action.', 403);
  return run(c, () => registry().batteryCatalogueUseCases.bulk(b.data.productIds, b.data.action, actor(c)));
});

routes.get('/catalogue/:id', requirePermissions([PERMISSIONS.BATTERIES_READ]), (c) => run(c, () => registry().batteryCatalogueUseCases.detail(param(c, 'id'), has(c, PERMISSIONS.PRODUCT_COSTS_READ) || has(c, PERMISSIONS.PRODUCT_COSTS_MANAGE))));
routes.get('/catalogue/:id/readiness', requirePermissions([PERMISSIONS.BATTERIES_READ]), (c) => run(c, () => registry().batteryCatalogueUseCases.readiness(param(c, 'id'))));

routes.put('/catalogue/:id', requirePermissions([PERMISSIONS.BATTERIES_CATALOGUE_MANAGE]), async (c) => {
  const b = await body(c, updateBattery);
  if (!b.ok) return b.response;
  return run(c, () => registry().batteryCatalogueUseCases.update(param(c, 'id'), b.data, actor(c)));
});

routes.post('/catalogue/:id/verify', requirePermissions([PERMISSIONS.BATTERIES_COMPAT_VERIFY]), async (c) => {
  const b = await body(c, z.object({ note: nullableText(500) }));
  if (!b.ok) return b.response;
  return run(c, () => registry().batteryCatalogueUseCases.verify(param(c, 'id'), actor(c), b.data.note ?? null));
});

routes.post('/catalogue/:id/transition', requirePermissions([PERMISSIONS.BATTERIES_READ]), async (c) => {
  const b = await body(c, z.object({ action: z.enum(['SUBMIT_REVIEW', 'MARK_READY', 'PUBLISH', 'UNPUBLISH', 'ARCHIVE', 'RESTORE', 'REOPEN']), reason: nullableText(500) }));
  if (!b.ok) return b.response;
  const needs = ['PUBLISH', 'UNPUBLISH', 'ARCHIVE', 'RESTORE'].includes(b.data.action) ? PERMISSIONS.BATTERIES_PUBLISH : PERMISSIONS.BATTERIES_CATALOGUE_MANAGE;
  if (!has(c, needs)) return bad(c, 'FORBIDDEN', 'You do not have the right to perform this action.', 403);
  return run(c, () => registry().batteryCatalogueUseCases.transition(param(c, 'id'), b.data.action, actor(c), b.data.reason ?? null));
});

routes.post('/catalogue/:id/aliases', requirePermissions([PERMISSIONS.BATTERIES_CATALOGUE_MANAGE]), async (c) => {
  const b = await body(c, z.object({ alias: z.string().trim().min(1).max(120), aliasType: z.enum(BATTERY_ALIAS_TYPES).optional(), source: nullableText(200) }));
  if (!b.ok) return b.response;
  return run(c, () => registry().batteryCatalogueUseCases.addAlias(param(c, 'id'), b.data, actor(c)), 201);
});
routes.post('/catalogue/:id/aliases/:aliasId/archive', requirePermissions([PERMISSIONS.BATTERIES_CATALOGUE_MANAGE]), (c) => run(c, () => registry().batteryCatalogueUseCases.setAliasActive(param(c, 'id'), param(c, 'aliasId'), false, actor(c))));
routes.post('/catalogue/:id/aliases/:aliasId/restore', requirePermissions([PERMISSIONS.BATTERIES_CATALOGUE_MANAGE]), (c) => run(c, () => registry().batteryCatalogueUseCases.setAliasActive(param(c, 'id'), param(c, 'aliasId'), true, actor(c))));

async function evidenceUpload(c: Ctx, subjectType: 'BATTERY' | 'COMPATIBILITY') {
  const form = await c.req.parseBody({ all: true }).catch(() => null);
  if (!form) return bad(c, 'BAD_INPUT', 'Expected multipart form data.');
  const raw = form['files'] ?? form['file'];
  const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => f instanceof File);
  const kind = typeof form['kind'] === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(form['kind']) ? (form['kind'] as (typeof EVIDENCE_KINDS)[number]) : 'OTHER';
  const note = typeof form['note'] === 'string' ? form['note'].slice(0, 300) : null;
  const setPrimaryImage = form['setPrimaryImage'] === 'true' || form['setPrimaryImage'] === 'on';
  const buffers = await Promise.all(files.map(async (f) => ({ filename: f.name, mime: f.type, buffer: Buffer.from(await f.arrayBuffer()) })));
  return run(c, () => registry().batteryCatalogueUseCases.attachEvidence({ subjectType, subjectId: param(c, 'id'), kind, note, files: buffers, actorId: actor(c), setPrimaryImage }), 201);
}
routes.post('/catalogue/:id/evidence', requirePermissions([PERMISSIONS.BATTERIES_CATALOGUE_MANAGE]), (c) => evidenceUpload(c, 'BATTERY'));

// ------------------------------------------------------------------ devices
const brandBody = z.object({ name: z.string().trim().min(1).max(60), searchAliases: z.array(z.string().trim().max(60)).max(20).optional(), isFeatured: z.boolean().optional(), displayOrder: z.number().int().min(0).optional(), logoAssetId: uuid.nullable().optional() });
routes.get('/brands', requirePermissions([PERMISSIONS.BATTERIES_READ]), (c) => run(c, () => registry().deviceCatalogueUseCases.listBrands(c.req.query('includeArchived') === 'true')));
routes.post('/brands', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), async (c) => {
  const b = await body(c, brandBody);
  if (!b.ok) return b.response;
  return run(c, () => registry().deviceCatalogueUseCases.createBrand(b.data, actor(c)), 201);
});
routes.post('/brands/reorder', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), async (c) => {
  const b = await body(c, z.object({ orderedIds: z.array(uuid).min(1).max(500) }));
  if (!b.ok) return b.response;
  return run(c, () => registry().deviceCatalogueUseCases.reorderBrands(b.data.orderedIds, actor(c)));
});
routes.put('/brands/:id', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), async (c) => {
  const b = await body(c, brandBody.partial());
  if (!b.ok) return b.response;
  return run(c, () => registry().deviceCatalogueUseCases.updateBrand(param(c, 'id'), b.data, actor(c)));
});
routes.post('/brands/:id/archive', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), (c) => run(c, () => registry().deviceCatalogueUseCases.setBrandStatus(param(c, 'id'), 'ARCHIVED', actor(c))));
routes.post('/brands/:id/restore', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), (c) => run(c, () => registry().deviceCatalogueUseCases.setBrandStatus(param(c, 'id'), 'ACTIVE', actor(c))));
routes.get('/brands/:id/series', requirePermissions([PERMISSIONS.BATTERIES_READ]), (c) => run(c, () => registry().deviceCatalogueUseCases.listSeries(param(c, 'id'), c.req.query('includeArchived') === 'true')));
routes.post('/brands/:id/series/reorder', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), async (c) => {
  const b = await body(c, z.object({ orderedIds: z.array(uuid).min(1).max(500) }));
  if (!b.ok) return b.response;
  return run(c, () => registry().deviceCatalogueUseCases.reorderSeries(param(c, 'id'), b.data.orderedIds, actor(c)));
});

const seriesBody = z.object({ brandId: uuid, name: z.string().trim().min(1).max(80), searchAliases: z.array(z.string().trim().max(80)).max(20).optional(), displayOrder: z.number().int().min(0).optional() });
routes.post('/series', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), async (c) => {
  const b = await body(c, seriesBody);
  if (!b.ok) return b.response;
  return run(c, () => registry().deviceCatalogueUseCases.createSeries(b.data, actor(c)), 201);
});
routes.put('/series/:id', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), async (c) => {
  const b = await body(c, seriesBody.omit({ brandId: true }).partial());
  if (!b.ok) return b.response;
  return run(c, () => registry().deviceCatalogueUseCases.updateSeries(param(c, 'id'), b.data, actor(c)));
});
routes.post('/series/:id/archive', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), (c) => run(c, () => registry().deviceCatalogueUseCases.setSeriesStatus(param(c, 'id'), 'ARCHIVED', actor(c))));
routes.post('/series/:id/restore', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), (c) => run(c, () => registry().deviceCatalogueUseCases.setSeriesStatus(param(c, 'id'), 'ACTIVE', actor(c))));

const deviceBody = z.object({
  brandId: uuid,
  seriesId: uuid.nullable().optional(),
  model: z.string().trim().min(1).max(120),
  modelNumber: nullableText(80),
  variant: nullableText(80),
  modelAliases: z.array(z.string().trim().max(120)).max(30).optional(),
  releaseYear: z.number().int().min(1995).max(2100).nullable().optional(),
  displayOrder: z.number().int().min(0).optional(),
  sourceReference: nullableText(200),
});
routes.get('/devices', requirePermissions([PERMISSIONS.BATTERIES_READ]), (c) => {
  const q = c.req.query();
  return run(c, () => registry().deviceCatalogueUseCases.listDevices({ brandId: q.brandId || undefined, seriesId: q.seriesId || undefined, q: q.q || undefined, status: (q.status as never) || undefined, limit: Number(q.limit) || undefined }));
});
routes.post('/devices', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), async (c) => {
  const b = await body(c, deviceBody);
  if (!b.ok) return b.response;
  return run(c, () => registry().deviceCatalogueUseCases.createDevice(b.data, actor(c)), 201);
});
routes.post('/devices/merge/preview', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), async (c) => {
  const b = await body(c, z.object({ sourceId: uuid, targetId: uuid }));
  if (!b.ok) return b.response;
  return run(c, () => registry().deviceCatalogueUseCases.mergePreview(b.data.sourceId, b.data.targetId));
});
routes.post('/devices/merge', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), async (c) => {
  const b = await body(c, z.object({ sourceId: uuid, targetId: uuid, reason: z.string().trim().min(3).max(500) }));
  if (!b.ok) return b.response;
  return run(c, () => registry().deviceCatalogueUseCases.merge(b.data.sourceId, b.data.targetId, actor(c), b.data.reason));
});
routes.get('/devices/:id', requirePermissions([PERMISSIONS.BATTERIES_READ]), (c) => run(c, () => registry().deviceCatalogueUseCases.findDevice(param(c, 'id'))));
routes.put('/devices/:id', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), async (c) => {
  const b = await body(c, deviceBody.partial());
  if (!b.ok) return b.response;
  return run(c, () => registry().deviceCatalogueUseCases.updateDevice(param(c, 'id'), b.data, actor(c)));
});
routes.post('/devices/:id/archive', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), (c) => run(c, () => registry().deviceCatalogueUseCases.setDeviceStatus(param(c, 'id'), 'ARCHIVED', actor(c))));
routes.post('/devices/:id/restore', requirePermissions([PERMISSIONS.BATTERIES_DEVICES_MANAGE]), (c) => run(c, () => registry().deviceCatalogueUseCases.setDeviceStatus(param(c, 'id'), 'ACTIVE', actor(c))));

// ------------------------------------------------------------ compatibility
const claimFields = {
  evidenceStatus: z.enum(COMPAT_EVIDENCE_STATUSES).optional(),
  evidenceType: nullableText(60),
  evidenceSource: nullableText(300),
  notes: nullableText(5000),
  publicCondition: nullableText(300),
};
routes.get('/compatibility', requirePermissions([PERMISSIONS.BATTERIES_READ]), (c) => {
  const q = c.req.query();
  return run(c, () => registry().batteryCompatibilityUseCases.list({ productId: q.productId || undefined, deviceId: q.deviceId || undefined, workflowStatus: (q.workflowStatus as never) || undefined, evidenceStatus: (q.evidenceStatus as never) || undefined, limit: Number(q.limit) || undefined }));
});
routes.post('/compatibility', requirePermissions([PERMISSIONS.BATTERIES_COMPAT_PROPOSE]), async (c) => {
  const b = await body(c, z.object({ productId: uuid, deviceIds: z.array(uuid).min(1).max(50), ...claimFields }));
  if (!b.ok) return b.response;
  return run(c, () => registry().batteryCompatibilityUseCases.create({ ...b.data, actorId: actor(c) }), 201);
});
routes.get('/compatibility/:id', requirePermissions([PERMISSIONS.BATTERIES_READ]), (c) => run(c, () => registry().batteryCompatibilityUseCases.detail(param(c, 'id'))));
routes.put('/compatibility/:id', requirePermissions([PERMISSIONS.BATTERIES_COMPAT_PROPOSE]), async (c) => {
  const b = await body(c, z.object({ deviceId: uuid.optional(), ...claimFields }));
  if (!b.ok) return b.response;
  return run(c, () => registry().batteryCompatibilityUseCases.update(param(c, 'id'), b.data, actor(c)));
});
routes.post('/compatibility/:id/transition', requirePermissions([PERMISSIONS.BATTERIES_READ]), async (c) => {
  const b = await body(c, z.object({ action: z.enum(['SUBMIT', 'VERIFY', 'REJECT', 'PUBLISH', 'UNPUBLISH', 'ARCHIVE', 'RESTORE', 'REOPEN']), evidenceStatus: z.enum(COMPAT_EVIDENCE_STATUSES).optional(), publicCondition: nullableText(300), reason: nullableText(500) }));
  if (!b.ok) return b.response;
  const needs = b.data.action === 'VERIFY' || b.data.action === 'REJECT' ? PERMISSIONS.BATTERIES_COMPAT_VERIFY
    : b.data.action === 'SUBMIT' || b.data.action === 'REOPEN' ? PERMISSIONS.BATTERIES_COMPAT_PROPOSE
    : PERMISSIONS.BATTERIES_PUBLISH;
  if (!has(c, needs)) return bad(c, 'FORBIDDEN', 'You do not have the right to perform this action.', 403);
  return run(c, () => registry().batteryCompatibilityUseCases.transition(param(c, 'id'), b.data.action, actor(c), { evidenceStatus: b.data.evidenceStatus, publicCondition: b.data.publicCondition, reason: b.data.reason ?? undefined }));
});
routes.post('/compatibility/:id/evidence', requirePermissions([PERMISSIONS.BATTERIES_COMPAT_PROPOSE]), (c) => evidenceUpload(c, 'COMPATIBILITY'));

// -------------------------------------------------------------------- stock
const canRecordCost = (c: Ctx) => has(c, PERMISSIONS.PRODUCT_COSTS_MANAGE);
const canSeeCost = (c: Ctx) => has(c, PERMISSIONS.PRODUCT_COSTS_READ) || has(c, PERMISSIONS.PRODUCT_COSTS_MANAGE);
routes.get('/stock/locations', requirePermissions([PERMISSIONS.INVENTORY_READ]), (c) => run(c, () => registry().inventoryLedgerUseCases.listLocations()));
routes.get('/stock/movements', requirePermissions([PERMISSIONS.INVENTORY_READ]), (c) => {
  const productId = c.req.query('productId');
  return run(c, () => (productId ? registry().inventoryLedgerUseCases.movementsFor(productId, canSeeCost(c), Number(c.req.query('limit')) || 50) : registry().inventoryLedgerUseCases.recentMovements(canSeeCost(c), Number(c.req.query('limit')) || 50)));
});
routes.post('/stock/movements', requirePermissions([PERMISSIONS.INVENTORY_ADJUST]), async (c) => {
  const b = await body(c, z.object({ productId: uuid, movementType: z.enum(MOVEMENT_TYPES), quantity: z.number().int(), reason: z.string().trim().min(1).max(500), locationCode: nullableText(20), supplierName: nullableText(160), referenceNumber: nullableText(120), unitCostUgx: z.number().int().min(0).nullable().optional() }));
  if (!b.ok) return b.response;
  return run(c, () => registry().inventoryLedgerUseCases.recordMovement({ ...b.data, actorId: actor(c), canRecordCost: canRecordCost(c) }), 201);
});
routes.post('/stock/match', requirePermissions([PERMISSIONS.INVENTORY_READ]), async (c) => {
  const b = await body(c, z.object({ code: z.string().trim().min(1).max(120) }));
  if (!b.ok) return b.response;
  return run(c, () => registry().inventoryLedgerUseCases.matchCode(b.data.code));
});
const receiptLine = z.object({ id: uuid.optional(), scannedCode: nullableText(120), productId: uuid.nullable().optional(), quantity: z.number().int(), unitCostUgx: z.number().int().min(0).nullable().optional(), notes: nullableText(300) });
routes.get('/stock/receipts', requirePermissions([PERMISSIONS.INVENTORY_READ]), (c) => run(c, () => registry().inventoryLedgerUseCases.listReceipts(canSeeCost(c), Number(c.req.query('limit')) || 50)));
routes.post('/stock/receipts', requirePermissions([PERMISSIONS.INVENTORY_ADJUST]), async (c) => {
  const b = await body(c, z.object({ supplierName: z.string().trim().min(1).max(160), supplierReference: nullableText(120), locationCode: nullableText(20), notes: nullableText(1000), lines: z.array(receiptLine).min(1).max(500) }));
  if (!b.ok) return b.response;
  return run(c, () => registry().inventoryLedgerUseCases.createReceipt({ ...b.data, supplierReference: b.data.supplierReference ?? null, locationCode: b.data.locationCode ?? null, notes: b.data.notes ?? null, createdBy: actor(c), canRecordCost: canRecordCost(c), lines: b.data.lines.map((l) => ({ scannedCode: l.scannedCode ?? null, productId: l.productId ?? null, quantity: l.quantity, unitCostUgx: l.unitCostUgx ?? null, notes: l.notes ?? null })) }), 201);
});
routes.get('/stock/receipts/:id', requirePermissions([PERMISSIONS.INVENTORY_READ]), (c) => run(c, () => registry().inventoryLedgerUseCases.findReceipt(param(c, 'id'), canSeeCost(c))));
routes.put('/stock/receipts/:id/lines', requirePermissions([PERMISSIONS.INVENTORY_ADJUST]), async (c) => {
  const b = await body(c, z.object({ lines: z.array(receiptLine).min(1).max(500) }));
  if (!b.ok) return b.response;
  return run(c, () => registry().inventoryLedgerUseCases.updateReceiptLines(param(c, 'id'), b.data.lines.map((l) => ({ id: l.id, scannedCode: l.scannedCode ?? null, productId: l.productId ?? null, quantity: l.quantity, unitCostUgx: l.unitCostUgx ?? null, notes: l.notes ?? null })), actor(c), canRecordCost(c)));
});
routes.post('/stock/receipts/:id/apply', requirePermissions([PERMISSIONS.INVENTORY_ADJUST]), (c) => run(c, () => registry().inventoryLedgerUseCases.applyReceipt(param(c, 'id'), actor(c), canRecordCost(c))));
routes.post('/stock/receipts/:id/cancel', requirePermissions([PERMISSIONS.INVENTORY_ADJUST]), async (c) => {
  const b = await body(c, z.object({ reason: z.string().trim().min(1).max(500) }));
  if (!b.ok) return b.response;
  return run(c, () => registry().inventoryLedgerUseCases.cancelReceipt(param(c, 'id'), actor(c), b.data.reason));
});
routes.get('/stock/counts', requirePermissions([PERMISSIONS.INVENTORY_READ]), (c) => run(c, () => registry().inventoryLedgerUseCases.listCounts(Number(c.req.query('limit')) || 50)));
routes.post('/stock/counts', requirePermissions([PERMISSIONS.INVENTORY_ADJUST]), async (c) => {
  const b = await body(c, z.object({ countType: z.enum(['CYCLE', 'FULL']), locationCode: nullableText(20), notes: nullableText(1000), lines: z.array(z.object({ productId: uuid, countedQuantity: z.number().int().min(0), reason: nullableText(300) })).min(1).max(1000) }));
  if (!b.ok) return b.response;
  return run(c, () => registry().inventoryLedgerUseCases.createCount({ countType: b.data.countType, locationCode: b.data.locationCode ?? null, notes: b.data.notes ?? null, createdBy: actor(c), lines: b.data.lines.map((l) => ({ productId: l.productId, countedQuantity: l.countedQuantity, reason: l.reason ?? null })) }), 201);
});
routes.get('/stock/counts/:id', requirePermissions([PERMISSIONS.INVENTORY_READ]), (c) => run(c, () => registry().inventoryLedgerUseCases.findCount(param(c, 'id'))));
routes.post('/stock/counts/:id/apply', requirePermissions([PERMISSIONS.INVENTORY_ADJUST]), (c) => run(c, () => registry().inventoryLedgerUseCases.applyCount(param(c, 'id'), actor(c))));
routes.post('/stock/counts/:id/cancel', requirePermissions([PERMISSIONS.INVENTORY_ADJUST]), async (c) => {
  const b = await body(c, z.object({ reason: z.string().trim().min(1).max(500) }));
  if (!b.ok) return b.response;
  return run(c, () => registry().inventoryLedgerUseCases.cancelCount(param(c, 'id'), actor(c), b.data.reason));
});

// ------------------------------------------------------------------- demand
routes.get('/demand/overview', requirePermissions([PERMISSIONS.BATTERIES_READ]), (c) => run(c, () => registry().batteryFinderUseCases.demandOverview(Number(c.req.query('days')) || 30)));
routes.get('/demand/requests', requirePermissions([PERMISSIONS.BATTERIES_READ]), (c) => run(c, () => registry().batteryFinderUseCases.listRequests((c.req.query('status') as never) || 'OPEN', Number(c.req.query('limit')) || 200)));
routes.post('/demand/requests/:id/resolve', requirePermissions([PERMISSIONS.BATTERIES_DEMAND_MANAGE]), async (c) => {
  const b = await body(c, z.object({ action: z.enum(['MAP_DEVICE', 'ADD_ALIAS', 'MAP_BATTERY', 'CREATE_DRAFT', 'INVALID', 'RESOLVED']), note: nullableText(500), deviceId: uuid.nullable().optional(), aliasId: uuid.nullable().optional(), batteryProductId: uuid.nullable().optional() }));
  if (!b.ok) return b.response;
  return run(c, () => registry().batteryFinderUseCases.resolveRequest(param(c, 'id'), { ...b.data, note: b.data.note ?? null }, actor(c)));
});

// ------------------------------------------------------------ finder config
routes.get('/finder-config', requirePermissions([PERMISSIONS.BATTERIES_READ]), (c) => run(c, () => registry().batteryFinderUseCases.configWithVersion()));
routes.put('/finder-config', requirePermissions([PERMISSIONS.BATTERIES_PUBLISH]), async (c) => {
  const b = await body(c, z.object({ expectedVersion: z.number().int().min(0), config: z.record(z.string(), z.unknown()) }));
  if (!b.ok) return b.response;
  return run(c, () => registry().batteryFinderUseCases.saveConfig(b.data.config, b.data.expectedVersion, actor(c)));
});

export default routes;
