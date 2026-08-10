import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { AddProductImageByUrlUseCase } from '../../../../application/use-cases/products/AddProductImageByUrlUseCase';
import { RemoveProductImageUseCase } from '../../../../application/use-cases/products/RemoveProductImageUseCase';
import { SetAttributeValueUseCase } from '../../../../application/use-cases/products/SetAttributeValueUseCase';
import { DefineAttributeUseCase } from '../../../../application/use-cases/products/DefineAttributeUseCase';
import { RecordProductSlugChangeUseCase } from '../../../../application/use-cases/products/RecordProductSlugChangeUseCase';
import { validateStockAdjustment } from '../../../../domain/inventory/Inventory';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

const routes = new Hono();
routes.use('*', authMiddleware);

routes.post('/:id/images', requirePermissions([PERMISSIONS.PRODUCTS_WRITE]), async (c) => {
  const productId = c.req.param('id') ?? '';
  const body = await c.req.json().catch(() => null);
  if (!body) {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Body must be JSON.' } };
    return c.json(res, 400);
  }

  const registry = Registry.getInstance();
  const uc = new AddProductImageByUrlUseCase(registry.productImageRepo);
  const result = await uc.execute({
    productId,
    url: String(body.url ?? ''),
    altText: body.altText == null ? null : String(body.altText),
    makePrimary: Boolean(body.makePrimary),
  });
  if (!result.ok) {
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, 400);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: (c.get('user') as any).id,
    action: 'PRODUCT_IMAGE_ADDED',
    entity: 'product',
    entityId: productId,
    newState: { imageId: result.image.id, url: result.image.url, isPrimary: result.image.isPrimary },
  });

  const res: ApiResponse<typeof result.image> = { success: true, data: result.image };
  return c.json(res, 201);
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
      makeFirstPrimary: body['makeFirstPrimary'] === 'true' || body['makeFirstPrimary'] === '1'
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
        imageIds: savedImages.map(i => i.id) 
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
  const uc = new RemoveProductImageUseCase(registry.productImageRepo);
  const result = await uc.execute(imageId);
  if (!result.ok) {
    const res: ApiResponse<never> = { success: false, error: { code: 'NOT_FOUND', message: 'Image not found.' } };
    return c.json(res, 404);
  }
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

// Get raw product details for administration editing
routes.get('/:id', requirePermissions([PERMISSIONS.PRODUCTS_READ]), async (c) => {
  const productId = c.req.param('id') ?? '';
  const registry = Registry.getInstance();
  const product = await registry.productRepo.findById(productId);
  if (!product) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Product not found.' } }, 404);
  }
  return c.json({ success: true, data: product });
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
  if (priceUgx < 0 || !Number.isInteger(priceUgx)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Price must be a positive integer.' } }, 400);
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
    await registry.productRepo.createProduct(productEntity, categoryId);

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
  if (priceUgx < 0 || !Number.isInteger(priceUgx)) {
    return c.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Price must be a positive integer.' } }, 400);
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
    await registry.productRepo.updateProductProperties(productEntity, categoryId);

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

export default routes;

