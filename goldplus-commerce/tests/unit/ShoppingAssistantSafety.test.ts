import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canAccessProductFinderSession,
  productFinderAnonymousId,
} from "../../apps/api/src/application/services/product-finder/ProductFinderAccess";

const session = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: null,
  anonymousId: productFinderAnonymousId("a".repeat(43)),
  status: "FINDER_STARTED",
  answers: {},
  recommendations: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("Shopping Assistant safety", () => {
  it("authorizes only the server-issued anonymous capability", () => {
    expect(
      canAccessProductFinderSession(session, { accessToken: "a".repeat(43) }),
    ).toBe(true);
    expect(
      canAccessProductFinderSession(session, { accessToken: "b".repeat(43) }),
    ).toBe(false);
    expect(session.anonymousId).not.toContain("a".repeat(43));
  });

  it("requires verified identity for customer-owned sessions", () => {
    const owned = { ...session, userId: "customer-1" };
    expect(canAccessProductFinderSession(owned, { userId: "customer-1" })).toBe(
      true,
    );
    expect(
      canAccessProductFinderSession(owned, {
        userId: "customer-2",
        accessToken: "a".repeat(43),
      }),
    ).toBe(false);
  });

  it("uses configured API routing and safe DOM rendering with truthful intents", () => {
    const root = path.resolve(
      __dirname,
      "../../apps/web/src/components/product-finder/ProductFinderShell.astro",
    );
    const source = fs.readFileSync(root, "utf8");
    const route = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../apps/api/src/interfaces/http/routes/product-finder.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain("http://localhost:3000");
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("Added to cart!");
    expect(source).not.toContain("Opening WhatsApp");
    expect(source).toContain("Your cart was not changed");
    expect(source).toContain("NO_MATCH");
    expect(route).not.toContain("x-user-id");
  });
});
