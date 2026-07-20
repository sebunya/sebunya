import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { productFinderRoutes } from "../../src/interfaces/http/routes/product-finder";
import { Registry } from "../../src/infrastructure/Registry";

describe("ProductFinderRoutes", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    // Mock user context mapping
    app.use("*", async (c, next) => {
      c.set("user", { id: "u1" });
      await next();
    });
    app.route("/product-finder", productFinderRoutes);
  });

  it("starts session successfully", async () => {
    const spy = vi
      .spyOn(Registry.getInstance().startProductFinderUseCase, "execute")
      .mockResolvedValue({
        sessionId: "11111111-1111-4111-8111-111111111111",
        accessToken: "x".repeat(43),
      });

    const res = await app.request("/product-finder/sessions", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sessionId).toBe("11111111-1111-4111-8111-111111111111");
    expect(spy).toHaveBeenCalledWith({ userId: undefined });
  });

  it("answers step successfully", async () => {
    const spy = vi
      .spyOn(Registry.getInstance().answerProductFinderStepUseCase, "execute")
      .mockResolvedValue({ success: true });

    const id = "11111111-1111-4111-8111-111111111111";
    const token = "x".repeat(43);
    const res = await app.request(`/product-finder/sessions/${id}/answers`, {
      method: "PUT",
      body: JSON.stringify({ stepId: "category", answer: "Power" }),
      headers: {
        "Content-Type": "application/json",
        "x-product-finder-access-token": token,
      },
    });

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith({
      sessionId: id,
      stepId: "category",
      answer: "Power",
      principal: { accessToken: token },
    });
  });
});
