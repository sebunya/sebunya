import { Hono } from "hono";
import { z } from "zod";
import { Registry } from "../../../infrastructure/Registry";
import { ProductFinderPrincipal } from "../../../application/ports/product-finder/ProductFinderRepository";

const productFinderRoutes = new Hono();
const sessionId = z.string().uuid();
const startSchema = z.object({}).strict();
const answerSchema = z
  .object({
    stepId: z.string().min(1).max(40),
    answer: z.string().min(1).max(160),
  })
  .strict();
const actionSchema = z
  .object({
    action: z.enum([
      "recommendation_clicked",
      "add_to_cart_intent",
      "whatsapp_intent",
    ]),
    productId: z.string().uuid(),
  })
  .strict();

async function principal(c: any): Promise<ProductFinderPrincipal | null> {
  const header = c.req.header("Authorization");
  if (header) {
    if (!header.startsWith("Bearer ")) return null;
    const verified = await Registry.getInstance().tokenSigner.verify(
      header.slice(7).trim(),
    );
    if (!verified) return null;
    return { userId: verified.subject };
  }
  const accessToken = c.req.header("x-product-finder-access-token");
  return accessToken && /^[A-Za-z0-9_-]{43}$/.test(accessToken)
    ? { accessToken }
    : {};
}

const invalid = (c: any, code = "INVALID_PAYLOAD", status: 400 | 401 = 400) =>
  c.json({ error: code }, status);

productFinderRoutes.post("/sessions", async (c) => {
  if (!startSchema.safeParse(await c.req.json().catch(() => ({}))).success)
    return invalid(c);
  const identity = await principal(c);
  if (!identity) return invalid(c, "UNAUTHENTICATED", 401);
  return c.json(
    await Registry.getInstance().startProductFinderUseCase.execute({
      userId: identity.userId,
    }),
    201,
  );
});

productFinderRoutes.put("/sessions/:sessionId/answers", async (c) => {
  const id = sessionId.safeParse(c.req.param("sessionId"));
  const body = answerSchema.safeParse(await c.req.json().catch(() => null));
  const identity = await principal(c);
  if (!identity) return invalid(c, "UNAUTHENTICATED", 401);
  if (!id.success || !body.success) return invalid(c);
  const result =
    await Registry.getInstance().answerProductFinderStepUseCase.execute({
      sessionId: id.data,
      principal: identity,
      ...body.data,
    });
  return result.success ? c.json({ success: true }) : invalid(c, result.error);
});

productFinderRoutes.post("/sessions/:sessionId/complete", async (c) => {
  const id = sessionId.safeParse(c.req.param("sessionId"));
  const identity = await principal(c);
  if (!identity) return invalid(c, "UNAUTHENTICATED", 401);
  if (!id.success) return invalid(c);
  const result =
    await Registry.getInstance().completeProductFinderUseCase.execute({
      sessionId: id.data,
      principal: identity,
    });
  if ("error" in result) return invalid(c, result.error);
  return c.json(Registry.getInstance().productFinderRedactor.redact(result));
});

productFinderRoutes.get("/sessions/:sessionId/recommendations", async (c) => {
  const id = sessionId.safeParse(c.req.param("sessionId"));
  const identity = await principal(c);
  if (!identity) return invalid(c, "UNAUTHENTICATED", 401);
  if (!id.success) return invalid(c);
  const result =
    await Registry.getInstance().getProductFinderRecommendationsUseCase.execute(
      { sessionId: id.data, principal: identity },
    );
  if ("error" in result) return invalid(c, result.error);
  return c.json(Registry.getInstance().productFinderRedactor.redact(result));
});

productFinderRoutes.post("/sessions/:sessionId/actions", async (c) => {
  const id = sessionId.safeParse(c.req.param("sessionId"));
  const body = actionSchema.safeParse(await c.req.json().catch(() => null));
  const identity = await principal(c);
  if (!identity) return invalid(c, "UNAUTHENTICATED", 401);
  if (!id.success || !body.success) return invalid(c);
  const result =
    await Registry.getInstance().recordProductFinderActionUseCase.execute({
      sessionId: id.data,
      principal: identity,
      ...body.data,
    });
  return "error" in result
    ? invalid(c, result.error)
    : c.json({ success: true, effect: "MEASUREMENT_INTENT_ONLY" });
});

export { productFinderRoutes };
