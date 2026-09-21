import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { RemoveProductImageUseCase } from '../../../../application/use-cases/products/RemoveProductImageUseCase';
import { SetAttributeValueUseCase } from '../../../../application/use-cases/products/SetAttributeValueUseCase';
import { DefineAttributeUseCase } from '../../../../application/use-cases/products/DefineAttributeUseCase';
import { RecordProductSlugChangeUseCase } from '../../../../application/use-cases/products/RecordProductSlugChangeUseCase';
import { validateStockAdjustment } from '../../../../domain/inventory/Inventory';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { parsePriceTiers } from '../../../../domain/products/PriceTiers';
import { UpdateProductListingUseCase } from '../../../../application/use-cases/products/UpdateProductListingUseCase';
import { FeedQualityUseCase } from '../../../../application/use-cases/seo-growth/MerchantFeedUseCase';

/** Above this a value cannot be a shilling price; it is a typo or an int4 overflow. */
const MAX_PRICE_UGX = 100_000_000;

const routes = new Hono();
routes.use('*', authMiddleware);

// Focus 4: adding an image by external https URL is an obsolete write path. Such
// a row would have no library asset and no renditions, so it could never enter a
// gallery slot or be served as a rendition. The path is disabled, not rerouted:
// upload the file through the media library (or the product gallery editor).
routes.post('/:id/images', requirePermissions([PERMISSIONS.PRODUCTS_WRITE]), async (c) => {
  const res: ApiResponse<never> = {
    success: false,
    error: { code: 'SUPERSEDED', message: 'Adding an image by URL is no longer supported. Upload the file in the product gallery editor (Admin → Products → Media) so it gets renditions and a slot.' },
  };
  return c.json(res, 410);
});

routes.post('/:id/images/upload', requirePermissions([PERMISSIONS.PRODUCTS_WRITE]), async (c) => {
  const productId = c.req.param('id') ?? '';
  
  // Fetch body supporting multipart arrays
  const body = await c.req.parseBody({ all: true });
  
  // Extract and normalize incoming single file or array to standard array
  const rawFiles = body['files'];
  const filesInput: File[] = Array.isArray(rawFiles) 
    ? rawFiles.filter((f): f is File => f instanceof File) 
    : (rawFiles instanceof File ? [rawFiles] : []);

  if (filesInput.length === 0) {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'At least one image file is required.' } }, 400);
  }

  // Transform web API Files to logical RawFilePayloads including raw Buffer
  const logicalFiles = await Promise.all(filesInput.map(async (f) => ({
    name: f.name,
    type: f.type,
    size: f.size,
    buffer: Buffer.from(await f.arrayBuffer())
  })));

  const registry = Registry.getInstance();
  try {
    const savedImages = await registry.uploadProductImagesUseCase.execute({
      productId,
      files: logicalFiles,
      altText: typeof body['altText'] === 'string' ? body['altText'] : undefined,
      makeFirstPrimary: body['makeFirstPrimary'] === 'true' || body['makeFirstPrimary'] === '1',
      actorId: (c.get('user') as any).id as string,
    });

    // Bulk audit record
    const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
    await auditUc.execute({
      actorId: (c.get('user') as any).id,
      action: 'PRODUCT_IMAGE_UPLOADED',
      entity: 'product',
      entityId: productId,
      newState: {
        count: savedImages.length,
        outcomes: savedImages.map((i) => ({ assetId: i.assetId, slot: i.slot, outcome: i.outcome })),
      },
    });

    return c.json({
      success: true,
      data: savedImages
    });

  } catch (err: any) {
    console.error('[ProductUploadRouter] Failed:', err);
    return c.json({
      success: false,
      error: {
        code: 'BAD_INPUT',
        message: 'Failed to upload images.'
      }
    }, 400);
  }
});

routes.delete('/images/:imageId', requirePermissions([PERMISSIONS.PRODUCTS_WRITE]), async (c) => {
  const imageId = c.req.param('imageId') ?? '';
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as any).id as string;
  // Focus 4: a slotted image leaves through the gallery service (a cover needs a
  // replacement — never a silent promotion); only a legacy, unslotted row may be
  // deleted directly.
  const owner = await registry.productImageRepo.findProductIdForImage(imageId);
  if (!owner) {
    const res: ApiResponse<never> = { success: false, error: { code: 'NOT_FOUND', message: 'Image not found.' } };
    return c.json(res, 404);
  }
  const removal = await registry.productMediaUseCases.removeImage({ productId: owner, imageId, actorId });
  if (!removal.ok) {
    const res: ApiResponse<never> = { success: false, error: { code: removal.code, message: removal.message } };
    return c.json(res, removal.code === 'NOT_FOUND' ? 404 : 409);
  }
  if ('legacyRowRemoved' in removal) {
    const uc = new RemoveProductImageUseCase(registry.productImageRepo);
    const legacy = await uc.execute(imageId);
    if (!legacy.ok) {
      const res: ApiResponse<never> = { success: false, error: { code: 'NOT_FOUND', message: 'Image not found.' } };
      return c.json(res, 404);
    }
  }
  const result = { ok: true as const, productId: owner };
  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: (c.get('user') as any).id,
    action: 'PRODUCT_IMAGE_REMOVED',
    entity: 'product',
    entityId: result.productId,
    previousState: { imageId },
  });
  const res: ApiResponse<{ productId: string }> = { success: true, data: { productId: result.productId } };
  return c.json(res);
});

routes.post('/:id/attribute-values', requirePermissions([PERMISSIONS.PRODUCTS_WRITE]), async (c) => {
  const productId = c.req.param('id') ?? '';
  const body = await c.req.json().catch(() => null);
  if (!body) {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } };
    return c.json(res, 400);
  }
  const registry = Registry.getInstance();
  const uc = new SetAttributeValueUseCase(registry.attributeRepo);
  const result = await uc.execute({
    productId,
    attributeId: String(body.attributeId ?? ''),
    value: String(body.value ?? ''),
    isVerified: Boolean(body.isVerified),
  });
  if (!result.ok) {
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, result.code === 'ATTRIBUTE_NOT_FOUND' ? 404 : 400);
  }
  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: (c.get('user') as any).id,
    action: 'PRODUCT_ATTRIBUTE_SET',
    entity: 'product',
    entityId: productId,
    newState: {
      attributeId: result.attribute.id,
      attributeName: result.attribute.name,
      value: result.value.value,
      isVerified: result.value.isVerified,
    },
  });
  const res: ApiResponse<typeof result.value> = { success: true, data: result.value };
  return c.json(res, 201);
});

routes.post('/attributes', requirePermissions([PERMISSIONS.PRODUCTS_WRITE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } };
    return c.json(res, 400);
  }
  const registry = Registry.getInstance();
  const uc = new DefineAttributeUseCase(registry.attributeRepo);
  const result = await uc.execute({
    categoryId: String(body.categoryId ?? ''),
    name: String(body.name ?? ''),
    slug: body.slug == null ? undefined : String(body.slug),
    unit: body.unit == null ? null : String(body.unit),
    isRequired: Boolean(body.isRequired),
    displayOrder: Number(body.displayOrder ?? 0),
  });
  if (!result.ok) {
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, 400);
  }
  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: (c.get('user') as any).id,
    action: 'ATTRIBUTE_DEFINED',
    entity: 'attribute',
    entityId: result.attribute.id,
    newState: { categoryId: result.attribute.categoryId, name: result.attribute.name, slug: result.attribute.slug, unit: result.attribute.unit },
  });
  const res: ApiResponse<typeof result.attribute> = { success: true, data: result.attribute };
  return c.json(res, 201);
});

import { ProductEntity } from '../../../../domain/products/ProductEntity';
import { randomUUID } from 'node:crypto';

// ── Listing quality ─────────────────────────────────────────────────────────
// Every live product ranked by what still holds its Shopping listing back.
// Registered before '/:id' so the path is not read as a product id.
routes.get('/listing-quality', requirePermissions([PERMISSIONS.PRODUCTS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const report = await new FeedQualityUseCase(() => registry.seoGrowthRepo.feedProducts()).execute();
  const products = [...report.products].sort((a, b) => b.issues.length - a.issues.length || (a.name ?? '').localeCompare(b.name ?? ''));
  return c.json({ success: true, data: { ...report, products } });
});

routes.get('/:id/listing', requirePermissions([PERMISSIONS.PRODUCTS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const listing = await registry.productRepo.getListing(c.req.param('id') ?? '');
  if (!listing) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Product not found.' } }, 404);
  const attributes = await registry.attributeRepo.findByCategoryId(listing.categoryId);
  return c.json({ success: true, data: { ...listing, categoryAttributes: attributes.map((a) => ({ id: a.id, name: a.name, unit: a.unit })) } });
});

routes.put('/:id/listing', requirePermissions([PERMISSIONS.PRODUCTS_WRITE]), async (c) => {
  const productId = c.req.param('id') ?? '';
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } }, 400);
  const registry = Registry.getInstance();
  const uc = new UpdateProductListingUseCase(registry.productRepo, registry.attributeRepo);
  const result = await uc.execute({
    productId,
    name: typeof body.name === 'string' ? body.name : undefined,
    shortDescription: typeof body.shortDescription === 'string' ? body.shortDescription : undefined,
    longDescription: typeof body.longDescription === 'string' ? body.longDescription : undefined,
    isFeedEligible: typeof body.isFeedEligible === 'boolean' ? body.isFeedEligible : undefined,
    specs: Array.isArray(body.specs) ? body.specs.map((s: any) => ({ name: String(s?.name ?? ''), value: String(s?.value ?? ''), unit: s?.unit == null ? null : String(s.unit), isVerified: s?.isVerified === true || s?.isVerified === 'true' })) : undefined,
  });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } }, result.code === 'NOT_FOUND' ? 404 : 400);
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as any).id, action: 'PRODUCT_LISTING_UPDATED', entity: 'product', entityId: productId, newState: result.changed,
  });
  return c.json({ success: true, data: result.changed });
});

// Get all categories
routes.get('/categories', requirePermissions([PERMISSIONS.PRODUCTS_READ]), async (c) => {
  try {
    const registry = Registry.getInstance();
    const cats = await registry.productRepo.getCategories();
    return c.json({ success: true, data: cats });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' } }, 500);
  }
});

// Bulk approval (0127). PRODUCTS_PUBLISH, because approving is publishing:
// an approved+active product is on the storefront. Every decision is audited
// with the full id list, so "who put these 94 products live" has an answer.
routes.post('/bulk-approval', requirePermissions([PERMISSIONS.PRODUCTS_PUBLISH]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.productIds) ? body.productIds.map(String) : [];
  const approvalStatus = String(body?.approvalStatus ?? '');
  if (ids.length === 0 || ids.length > 500 || !['draft', 'approved', 'rejected'].includes(approvalStatus)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'productIds (1–500) and an approvalStatus of draft, approved or rejected are required.' } }, 400);
  }
  // active follows the decision unless the caller says otherwise: approving
  // without activating leaves an invisible "approved" product, which is a
  // state nobody wants by accident.
  const active = typeof body?.active === 'boolean' ? body.active : approvalStatus === 'approved' ? true : approvalStatus === 'rejected' ? false : null;
  const registry = Registry.getInstance();
  // requireStock (default true when approving): never publish a product with no
  // stock recorded, so a bulk approval cannot fill the shop with "out of stock".
  const requireStock = approvalStatus === 'approved' && body?.requireStock !== false;
  const changed = await registry.productRepo.setApprovalMany(ids, approvalStatus as 'draft' | 'approved' | 'rejected', active, { requireStock });
  // Each batch is its own audited entity. (The first version passed 'bulk'
  // into a UUID column: the products were approved, the audit insert threw,
  // and the operator was shown an error for a change that had gone through.)
  const batchId = randomUUID();
  await new CreateAuditLogUseCase(registry.auditRepo).execute({
    actorId: (c.get('user') as any).id,
    action: 'PRODUCTS_BULK_APPROVAL',
    entity: 'product_bulk_approval',
    entityId: batchId,
    newState: { approvalStatus, active, requireStock, requested: ids.length, changed: changed.length, skipped: ids.length - changed.length, productIds: changed },
  });
  return c.json({ success: true, data: { batchId, changed: changed.length, skipped: ids.length - changed.length, requireStock, productIds: changed } });
});

// Get raw product details for administration editing
routes.get('/:id', requirePermissions([PERMISSIONS.PRODUCTS_READ]), async (c) => {
  const productId = c.req.param('id') ?? '';
  const registry = Registry.getInstance();
  const product = await registry.productRepo.findById(productId);
  if (!product) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Product not found.' } }, 404);
  }
  // 0127 — the product's own price tiers travel with it so the editor can show
  // and change the floor (Price A) beside the retail price (Price D).
  const [priceTiers, isFeedEligible] = await Promise.all([registry.productRepo.getPriceTiers(productId), registry.productRepo.feedEligibilityFor(productId)]);
  return c.json({ success: true, data: { ...product, priceTiers, isFeedEligible } });
});

// Create product
routes.post('/', requirePermissions([PERMISSIONS.PRODUCTS_WRITE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } }, 400);
  }

  const name = String(body.name ?? '').trim();
  const sku = String(body.sku ?? '').trim().toUpperCase();
  const modelNumber = String(body.modelNumber ?? '').trim();
  const slug = String(body.slug ?? '').trim().toLowerCase();
  const categoryId = String(body.categoryId ?? '').trim();
  const subcategory = body.subcategory ? String(body.subcategory).trim() : undefined;
  const shortDescription = String(body.shortDescription ?? '').trim();
  const longDescription = String(body.longDescription ?? '').trim();
  const priceUgx = Number(body.priceUgx ?? 0);
  const compareAtPriceUgx = body.compareAtPriceUgx ? Number(body.compareAtPriceUgx) : undefined;
  const stockStatus = String(body.stockStatus ?? 'in_stock');
  const imageUrl = body.imageUrl ? String(body.imageUrl).trim() : undefined;
  const active = body.active !== false;
  const approvalStatus = String(body.approvalStatus ?? 'draft');
  const stockQuantity = Number(body.stockQuantity ?? 0);

  // Validation
  if (name.length < 2 || name.length > 255) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Product name must be between 2 and 255 characters.' } }, 400);
  }
  if (!sku) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'SKU is required.' } }, 400);
  }
  if (!modelNumber) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Model number is required.' } }, 400);
  }
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Slug must be a unique, URL-safe string.' } }, 400);
  }
  if (priceUgx < 0 || !Number.isInteger(priceUgx) || priceUgx > MAX_PRICE_UGX) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: `Price must be a whole number of shillings up to ${MAX_PRICE_UGX.toLocaleString('en-UG')}.` } }, 400);
  }
  // The owner's rule: the site sells at the retail price (Price D) and no
  // discount may take the product below its own floor (Price A). The floor is
  // optional; a product without one is simply not discountable.
  const tiers = parsePriceTiers(body, priceUgx);
  if (!tiers.ok) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: tiers.message } }, 400);
  }
  if (compareAtPriceUgx !== undefined && (!Number.isInteger(compareAtPriceUgx) || compareAtPriceUgx < 0 || compareAtPriceUgx > MAX_PRICE_UGX)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Compare-at price must be a whole number of shillings, or left empty.' } }, 400);
  }
  if (stockQuantity < 0 || !Number.isInteger(stockQuantity)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Stock quantity must be a non-negative integer.' } }, 400);
  }
  if (!['in_stock', 'low_stock', 'out_of_stock', 'pre_order'].includes(stockStatus)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid stock status.' } }, 400);
  }
  if (!['draft', 'approved', 'rejected'].includes(approvalStatus)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid approval status.' } }, 400);
  }

  try {
    const registry = Registry.getInstance();
    
    const categoriesList = await registry.productRepo.getCategories();
    const cat = categoriesList.find((c: any) => c.id === categoryId);
    if (!cat) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Selected category does not exist.' } }, 400);
    }

    const skuExists = await registry.productRepo.checkSkuExists(sku);
    if (skuExists) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'SKU code is already registered.' } }, 400);
    }

    const slugExists = await registry.productRepo.checkSlugExists(slug);
    if (slugExists) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Product slug is already in use.' } }, 400);
    }

    const productId = randomUUID();

    const productEntity = new ProductEntity(
      productId,
      sku,
      modelNumber,
      name,
      slug,
      cat.name,
      subcategory,
      shortDescription,
      longDescription,
      priceUgx,
      compareAtPriceUgx,
      stockStatus as any,
      imageUrl,
      [],
      '1 Year',
      true,
      active,
      approvalStatus as any,
      stockStatus === 'pre_order',
      priceUgx > 0,
      !!imageUrl,
      stockQuantity,
      {}
    );

    // Save entity through repository orchestration
    await registry.productRepo.createProduct(productEntity, categoryId, tiers.value);

    const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
    await auditUc.execute({
      actorId: (c.get('user') as any).id,
      action: 'PRODUCT_CREATED',
      entity: 'product',
      entityId: productId,
      newState: { name, sku, slug, priceUgx, stockQuantity },
    });

    return c.json({ success: true, data: { id: productId } }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' } }, 500);
  }
});

// Update product properties
routes.put('/:id', requirePermissions([PERMISSIONS.PRODUCTS_WRITE]), async (c) => {
  const productId = c.req.param('id') ?? '';
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } }, 400);
  }

  const registry = Registry.getInstance();
  const existingProduct = await registry.productRepo.findById(productId);
  if (!existingProduct) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Product not found.' } }, 404);
  }

  const name = String(body.name ?? '').trim();
  const sku = String(body.sku ?? '').trim().toUpperCase();
  const modelNumber = String(body.modelNumber ?? '').trim();
  const slug = String(body.slug ?? '').trim().toLowerCase();
  const categoryId = String(body.categoryId ?? '').trim();
  const subcategory = body.subcategory ? String(body.subcategory).trim() : undefined;
  const shortDescription = String(body.shortDescription ?? '').trim();
  const longDescription = String(body.longDescription ?? '').trim();
  const priceUgx = Number(body.priceUgx ?? 0);
  const compareAtPriceUgx = body.compareAtPriceUgx ? Number(body.compareAtPriceUgx) : undefined;
  const stockStatus = String(body.stockStatus ?? 'in_stock');
  const imageUrl = body.imageUrl ? String(body.imageUrl).trim() : undefined;
  const active = body.active !== false;
  const approvalStatus = String(body.approvalStatus ?? 'draft');
  const stockQuantity = Number(body.stockQuantity ?? 0);

  // Validation
  if (name.length < 2 || name.length > 255) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Product name must be between 2 and 255 characters.' } }, 400);
  }
  if (!sku) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'SKU is required.' } }, 400);
  }
  if (!modelNumber) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Model number is required.' } }, 400);
  }
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Slug must be a unique, URL-safe string.' } }, 400);
  }
  if (priceUgx < 0 || !Number.isInteger(priceUgx) || priceUgx > MAX_PRICE_UGX) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: `Price must be a whole number of shillings up to ${MAX_PRICE_UGX.toLocaleString('en-UG')}.` } }, 400);
  }
  // The owner's rule: the site sells at the retail price (Price D) and no
  // discount may take the product below its own floor (Price A). The floor is
  // optional; a product without one is simply not discountable.
  const tiers = parsePriceTiers(body, priceUgx);
  if (!tiers.ok) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: tiers.message } }, 400);
  }
  if (compareAtPriceUgx !== undefined && (!Number.isInteger(compareAtPriceUgx) || compareAtPriceUgx < 0 || compareAtPriceUgx > MAX_PRICE_UGX)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Compare-at price must be a whole number of shillings, or left empty.' } }, 400);
  }
  if (stockQuantity < 0 || !Number.isInteger(stockQuantity)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Stock quantity must be a non-negative integer.' } }, 400);
  }
  if (!['in_stock', 'low_stock', 'out_of_stock', 'pre_order'].includes(stockStatus)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid stock status.' } }, 400);
  }
  if (!['draft', 'approved', 'rejected'].includes(approvalStatus)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid approval status.' } }, 400);
  }

  try {
    const categoriesList = await registry.productRepo.getCategories();
    const cat = categoriesList.find((c: any) => c.id === categoryId);
    if (!cat) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Selected category does not exist.' } }, 400);
    }

    const skuExists = await registry.productRepo.checkSkuExists(sku, productId);
    if (skuExists) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'SKU code is already registered.' } }, 400);
    }

    const slugExists = await registry.productRepo.checkSlugExists(slug, productId);
    if (slugExists) {
      return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Product slug is already in use.' } }, 400);
    }

    // Stock cannot be written below what is already reserved for customer
    // orders. Doing so does not free the units up — it strands the promises,
    // and every downstream reader clamps at zero, so the position would read as
    // an ordinary out-of-stock while those orders quietly became unfulfillable.
    //
    // The shape check is cheap and local; the reserved-quantity check is NOT
    // done here. Reading availability, validating against it and then writing
    // leaves a window in which a checkout reserves the last units — the
    // validation passes against a figure that is already stale. The comparison
    // and the write happen together, inside the conditional UPDATE below.
    const shape = validateStockAdjustment(0, stockQuantity);
    if (!shape.allowed) {
      return c.json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: shape.message },
      }, 400);
    }

    const stockResult = await registry.setProductStockUseCase.execute(productId, stockQuantity);
    if (stockResult === null) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Product not found.' } }, 404);
    }
    if (!stockResult.applied) {
      // Authoritative: these figures come from the same transaction that
      // refused the write, not from a pre-read that may since have changed.
      const decision = validateStockAdjustment(stockResult.reserved, stockQuantity);
      return c.json({
        success: false,
        error: {
          code: 'STOCK_BELOW_RESERVED',
          message: decision.allowed
            ? 'Stock could not be updated because reservations changed during the update. Please retry.'
            : decision.message,
          details: {
            reserved: stockResult.reserved,
            currentStock: stockResult.stock,
            requestedStock: stockQuantity,
            shortfall: Math.max(0, stockResult.reserved - stockQuantity),
          },
        },
      }, 409);
    }

    const productEntity = new ProductEntity(
      productId,
      sku,
      modelNumber,
      name,
      slug,
      cat.name,
      subcategory,
      shortDescription,
      longDescription,
      priceUgx,
      compareAtPriceUgx,
      stockStatus as any,
      imageUrl || existingProduct.imageUrl,
      existingProduct.features,
      existingProduct.warrantyPeriod,
      existingProduct.verificationEligible,
      active,
      approvalStatus as any,
      stockStatus === 'pre_order',
      priceUgx > 0,
      !!(imageUrl || existingProduct.imageUrl),
      stockQuantity,
      existingProduct.specifications
    );

    // Save entity through repository orchestration
    await registry.productRepo.updateProductProperties(productEntity, categoryId, tiers.value);
    // Merchant-feed listing is opt-out; only an explicit boolean changes it.
    if (typeof body.isFeedEligible === 'boolean') await registry.productRepo.setFeedEligibility(productId, body.isFeedEligible);

    // U6 AC6 — a slug change 301s the old product URL to the new one so inbound
    // links keep resolving. Fail-open: the product update already committed and
    // must not be reported as failed because the redirect insert hiccuped.
    if (existingProduct.slug && existingProduct.slug !== slug) {
      try {
        const slugChangeUc = new RecordProductSlugChangeUseCase(registry.seoRepo);
        await slugChangeUc.execute({ oldSlug: existingProduct.slug, newSlug: slug, actorId: (c.get('user') as any).id });
      } catch {
        // Redirect recording is best-effort; the admin can re-save to retry.
      }
      // Best-effort IndexNow ping for the moved URL pair. A no-op returning
      // READY_FOR_CREDENTIALS when INDEXNOW_KEY is unset; never blocks the save.
      try {
        const { SubmitIndexNowUseCase, INDEXNOW_HOST } = await import('../../../../application/use-cases/seo-growth/SubmitIndexNowUseCase');
        const { IndexNowClient } = await import('../../../../infrastructure/seo/IndexNowClient');
        await new SubmitIndexNowUseCase(new IndexNowClient()).execute([
          `https://${INDEXNOW_HOST}/products/${existingProduct.slug}`,
          `https://${INDEXNOW_HOST}/products/${slug}`,
        ]);
      } catch {
        // IndexNow is strictly best-effort.
      }
    }

    const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
    await auditUc.execute({
      actorId: (c.get('user') as any).id,
      action: 'PRODUCT_UPDATED',
      entity: 'product',
      entityId: productId,
      newState: { name, sku, slug, priceUgx, stockQuantity },
    });

    return c.json({ success: true, message: 'Product properties saved.' });
  } catch (err: any) {
    return c.json({ success: false, error: { code: 'SERVER_ERROR', message: 'An unexpected error occurred.' } }, 500);
  }
});

// ── Focus 4: product gallery (one cover, up to four slots) ───────────────────
// Reads return the full slot view with the revision the editor must send back.
// Every write is one action against an expected revision; a stale editor gets
// 409 STALE_REVISION with the current revision and must review before retrying.
routes.get('/:id/media', requirePermissions([PERMISSIONS.PRODUCTS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const view = await registry.productMediaUseCases.getGallery(c.req.param('id') ?? '');
  if (!view) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Product not found.' } }, 404);
  const history = await registry.productMediaUseCases.history(view.productId, 10);
  return c.json({ success: true, data: { ...view, history } });
});

routes.put('/:id/media', requirePermissions([PERMISSIONS.PRODUCTS_WRITE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const expectedRevision = Number(body?.expectedRevision);
  const action = body?.action;
  if (!body || !Number.isInteger(expectedRevision) || !action || typeof action.type !== 'string') {
    return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'expectedRevision and an action are required.' } }, 400);
  }
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as any).id as string;
  const productId = c.req.param('id') ?? '';
  const result = action.type === 'UNDO'
    ? await registry.productMediaUseCases.undo({ productId, expectedRevision, auditId: String(action.auditId ?? ''), actorId })
    : await registry.productMediaUseCases.mutate({ productId, expectedRevision, action, actorId, requestId: c.req.header('x-request-id') ?? null });
  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'STALE_REVISION' ? 409 : 422;
    return c.json({ success: false, error: { code: result.code, message: result.message, ...(result.code === 'STALE_REVISION' ? { currentRevision: result.currentRevision } : {}) } }, status);
  }
  return c.json({ success: true, data: result });
});

// Multi-image intake: up to four files reviewed together with a proposed slot map.
// Files go through the media library first (type sniffed, deduplicated, renditions),
// then ONE revision-checked slot-map write places them. A fifth file is refused
// up front; a slot that is already occupied is refused unless `replace` is set.
routes.post('/:id/media/upload', requirePermissions([PERMISSIONS.PRODUCTS_WRITE]), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const raw = body['files'];
  const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'Choose at least one image.' } }, 400);
  if (files.length > 4) return c.json({ success: false, error: { code: 'BAD_INPUT', message: `A gallery holds four images; ${files.length} were chosen. Remove ${files.length - 4}.` } }, 400);
  const expectedRevision = Number(body['expectedRevision']);
  if (!Number.isInteger(expectedRevision)) return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'expectedRevision is required.' } }, 400);
  const slotsRaw = body['slots'];
  const slots = (Array.isArray(slotsRaw) ? slotsRaw : slotsRaw ? [slotsRaw] : []).map((s) => Number(s));
  const replace = body['replace'] === 'true' || body['replace'] === '1';
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as any).id as string;
  const productId = c.req.param('id') ?? '';
  const snap = await registry.productMediaRepo.getSnapshot(productId);
  if (!snap) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Product not found.' } }, 404);
  if (snap.mediaRevision !== expectedRevision) return c.json({ success: false, error: { code: 'STALE_REVISION', message: 'The gallery changed while you were choosing files. Review it and try again.', currentRevision: snap.mediaRevision } }, 409);
  const current = registry.productMediaUseCases.currentMap(snap);
  const taken = new Set(current.map((a) => a.slot));
  const free = ([1, 2, 3, 4] as const).filter((s) => !taken.has(s));
  // Proposed map: explicit slots when given (must be legal and, unless replace, empty), else the next free slots.
  const proposed = files.map((f, i) => ({ file: f, slot: Number.isInteger(slots[i]) && slots[i] >= 1 && slots[i] <= 4 ? (slots[i] as 1 | 2 | 3 | 4) : free[i] }));
  const seen = new Set<number>();
  for (const p of proposed) {
    if (!p.slot) return c.json({ success: false, error: { code: 'INVALID_SLOT', message: 'Not enough empty slots for these files. Replace or remove an image first, or choose the slots explicitly.' } }, 422);
    if (seen.has(p.slot)) return c.json({ success: false, error: { code: 'DUPLICATE_SLOT', message: `Two files were given slot ${p.slot}.` } }, 422);
    seen.add(p.slot);
    if (taken.has(p.slot) && !replace) return c.json({ success: false, error: { code: 'SLOT_OCCUPIED', message: `Slot ${p.slot} already holds an image. Tick "replace" to overwrite it.` } }, 422);
  }
  // Stage every file first; a rejected file stops the batch before anything is assigned (valid staged assets stay in the library for choose-existing).
  const staged: Array<{ slot: 1 | 2 | 3 | 4; assetId: string; filename: string; deduplicated: boolean }> = [];
  const rejected: Array<{ filename: string; reason: string }> = [];
  for (const p of proposed) {
    const [outcome] = await registry.mediaLibraryUseCase.upload({ files: [{ filename: p.file.name, mime: p.file.type, buffer: Buffer.from(await p.file.arrayBuffer()) }], altText: null, caption: null, actorId });
    if (outcome.kind === 'STORED') staged.push({ slot: p.slot, assetId: outcome.asset.id, filename: p.file.name, deduplicated: outcome.deduplicated });
    else rejected.push({ filename: p.file.name, reason: outcome.reason });
  }
  if (rejected.length) return c.json({ success: false, error: { code: 'FILE_REJECTED', message: `Not assigned: ${rejected.map((r) => `${r.filename} (${r.reason})`).join(', ')}. The valid files are in the media library; choose them from there or fix the rejected file and try again.` }, data: { staged, rejected } }, 422);
  const map = [...current.filter((a) => !seen.has(a.slot)), ...staged.map((s) => ({ slot: s.slot, assetId: s.assetId, altText: null }))];
  const result = await registry.productMediaUseCases.replaceMap({ productId, expectedRevision, map, actorId, action: 'MULTI_UPLOAD', requestId: c.req.header('x-request-id') ?? null });
  if (!result.ok) {
    const status = result.code === 'STALE_REVISION' ? 409 : 422;
    return c.json({ success: false, error: { code: result.code, message: result.message }, data: { staged } }, status);
  }
  return c.json({ success: true, data: { ...result, staged } });
});

export default routes;

