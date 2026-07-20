import { Hono } from "hono";
import { z } from "zod";
import { ApiResponse, PERMISSIONS } from "@goldplus/shared";
import { Registry } from "../../../../infrastructure/Registry";
import { PimImportOperationError } from "../../../../application/use-cases/pim/PimImportOperationsUseCase";
import { authMiddleware } from "../../middleware/auth";
import { requirePermissions } from "../../middleware/permissions";

// audit-exempt: all mutations append PIM import events and row snapshots transactionally.
const routes = new Hono();
routes.use("*", authMiddleware);
const actor = (c: any) => (c.get("user") as any).id as string;
const scalar = z.union([
  z.string().max(5000),
  z.number().finite(),
  z.boolean(),
]);
const createBody = z.object({
  name: z.string().trim().min(1).max(160),
  sourceFilename: z.string().trim().min(1).max(255),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(["CREATE_ONLY", "UPSERT"]),
  rows: z.array(z.record(z.string(), scalar)).min(1).max(1000),
});
const mappingBody = z.object({
  expectedVersion: z.number().int().positive(),
  mapping: z.object({
    sku: z.string(),
    modelNumber: z.string(),
    name: z.string(),
    slug: z.string(),
    categorySlug: z.string(),
    shortDescription: z.string(),
    longDescription: z.string(),
    retailPriceUgx: z.string(),
  }),
});
const versionBody = z.object({ expectedVersion: z.number().int().positive() });
const approvalBody = versionBody.extend({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().min(3).max(2000),
});
const rollbackBody = versionBody.extend({
  reason: z.string().trim().min(3).max(2000),
});
function invalid(c: any, issues: any) {
  return c.json(
    {
      success: false,
      error: {
        code: "INVALID_BODY",
        message: issues[0]?.message ?? "Invalid body.",
      },
    } satisfies ApiResponse<never>,
    400,
  );
}
function failure(c: any, error: unknown) {
  const code =
    error instanceof PimImportOperationError
      ? error.code
      : "PIM_OPERATION_FAILED";
  const status =
    code === "IMPORT_NOT_FOUND"
      ? 404
      : ["STALE_VERSION", "INVALID_STATE"].includes(code)
        ? 409
        : 400;
  return c.json(
    {
      success: false,
      error: {
        code,
        message:
          error instanceof Error ? error.message : "PIM operation failed.",
      },
    } satisfies ApiResponse<never>,
    status,
  );
}
routes.get(
  "/",
  requirePermissions([PERMISSIONS.PIM_READ], "PERMISSION_DENIED"),
  async (c) =>
    c.json({
      success: true,
      data: await Registry.getInstance().pimImportOperationsUseCase.list(),
    }),
);
routes.get(
  "/mapping-fields",
  requirePermissions([PERMISSIONS.PIM_READ], "PERMISSION_DENIED"),
  (c) =>
    c.json({
      success: true,
      data: Registry.getInstance().pimImportOperationsUseCase.mappingFields(),
    }),
);
routes.post(
  "/",
  requirePermissions([PERMISSIONS.PIM_CREATE], "PERMISSION_DENIED"),
  async (c) => {
    const body = createBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalid(c, body.error.issues);
    try {
      return c.json(
        {
          success: true,
          data: await Registry.getInstance().pimImportOperationsUseCase.create({
            ...body.data,
            actorId: actor(c),
          }),
        },
        201,
      );
    } catch (error) {
      return failure(c, error);
    }
  },
);
routes.get(
  "/:id",
  requirePermissions([PERMISSIONS.PIM_READ], "PERMISSION_DENIED"),
  async (c) => {
    try {
      return c.json({
        success: true,
        data: await Registry.getInstance().pimImportOperationsUseCase.detail(
          String(c.req.param("id") ?? ""),
        ),
      });
    } catch (error) {
      return failure(c, error);
    }
  },
);
routes.post(
  "/:id/mapping",
  requirePermissions([PERMISSIONS.PIM_MAP], "PERMISSION_DENIED"),
  async (c) => {
    const body = mappingBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalid(c, body.error.issues);
    try {
      return c.json({
        success: true,
        data: await Registry.getInstance().pimImportOperationsUseCase.saveMapping(
          {
            id: String(c.req.param("id") ?? ""),
            actorId: actor(c),
            ...body.data,
          },
        ),
      });
    } catch (error) {
      return failure(c, error);
    }
  },
);
routes.post(
  "/:id/preview",
  requirePermissions([PERMISSIONS.PIM_MAP], "PERMISSION_DENIED"),
  async (c) => {
    const body = versionBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalid(c, body.error.issues);
    try {
      return c.json({
        success: true,
        data: await Registry.getInstance().pimImportOperationsUseCase.preview({
          id: String(c.req.param("id") ?? ""),
          actorId: actor(c),
          ...body.data,
        }),
      });
    } catch (error) {
      return failure(c, error);
    }
  },
);
routes.post(
  "/:id/approval",
  requirePermissions([PERMISSIONS.PIM_APPROVE], "PERMISSION_DENIED"),
  async (c) => {
    const body = approvalBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalid(c, body.error.issues);
    try {
      return c.json({
        success: true,
        data: await Registry.getInstance().pimImportOperationsUseCase.approve({
          id: String(c.req.param("id") ?? ""),
          actorId: actor(c),
          ...body.data,
        }),
      });
    } catch (error) {
      return failure(c, error);
    }
  },
);
routes.post(
  "/:id/apply",
  requirePermissions([PERMISSIONS.PIM_APPLY], "PERMISSION_DENIED"),
  async (c) => {
    const body = versionBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalid(c, body.error.issues);
    try {
      return c.json({
        success: true,
        data: await Registry.getInstance().pimImportOperationsUseCase.apply({
          id: String(c.req.param("id") ?? ""),
          actorId: actor(c),
          ...body.data,
        }),
      });
    } catch (error) {
      return failure(c, error);
    }
  },
);
routes.post(
  "/:id/rollback",
  requirePermissions([PERMISSIONS.PIM_ROLLBACK], "PERMISSION_DENIED"),
  async (c) => {
    const body = rollbackBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return invalid(c, body.error.issues);
    try {
      return c.json({
        success: true,
        data: await Registry.getInstance().pimImportOperationsUseCase.rollback({
          id: String(c.req.param("id") ?? ""),
          actorId: actor(c),
          ...body.data,
        }),
      });
    } catch (error) {
      return failure(c, error);
    }
  },
);
export default routes;
