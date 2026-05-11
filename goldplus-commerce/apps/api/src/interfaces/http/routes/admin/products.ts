import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { AddProductImageByUrlUseCase } from '../../../../application/use-cases/products/AddProductImageByUrlUseCase';
import { RemoveProductImageUseCase } from '../../../../application/use-cases/products/RemoveProductImageUseCase';
import { SetAttributeValueUseCase } from '../../../../application/use-cases/products/SetAttributeValueUseCase';
import { DefineAttributeUseCase } from '../../../../application/use-cases/products/DefineAttributeUseCase';
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
        message: err.message || 'Failed to upload images.'
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

export default routes;
