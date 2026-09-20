import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sortDiscoveryProducts } from "../../apps/web/src/lib/product-discovery";

const taxonomy = [
  { slug: "power-banks", name: "Power Banks", aliases: [], subcategories: [] },
  { slug: "chargers", name: "Chargers", aliases: [], subcategories: [] },
  { slug: "batteries", name: "Batteries", aliases: ["battery"], subcategories: [] },
] as never;
const p = (name: string, categoryName: string, price = 1000) => ({ id: name, name, categoryName, retailPriceUgx: price }) as never;
const items = [p("B cell", "Batteries"), p("A bank", "Power Banks"), p("C plug", "Chargers"), p("A cell", "Batteries")];
const names = (list: Array<{ name: string }>) => list.map((x) => x.name);

describe("the shop's default order leads with the visitor's own interest", () => {
  it("no preference = the standard order, unchanged", () => {
    expect(names(sortDiscoveryProducts(items, "default", taxonomy))).toEqual(["A bank", "C plug", "A cell", "B cell"]);
  });

  it("preferred categories move to the front, strongest first; the order inside a category is everyone's", () => {
    expect(names(sortDiscoveryProducts(items, "default", taxonomy, ["battery", "chargers"]))).toEqual(["A cell", "B cell", "C plug", "A bank"]);
  });

  it("nothing is hidden, and an unknown slug changes nothing", () => {
    expect(sortDiscoveryProducts(items, "default", taxonomy, ["nonsense"]).length).toBe(4);
    expect(names(sortDiscoveryProducts(items, "default", taxonomy, ["nonsense"]))).toEqual(["A bank", "C plug", "A cell", "B cell"]);
  });

  it("an order the shopper chose is never overridden", () => {
    expect(names(sortDiscoveryProducts(items, "name-a-z", taxonomy, ["batteries"]))).toEqual(["A bank", "A cell", "B cell", "C plug"]);
  });

  it("the page only personalises a returning browser on the bare default view, says so, offers the way out, and is never shared-cached", () => {
    const src = readFileSync("apps/web/src/pages/shop.astro", "utf8");
    expect(src).toContain("sort === 'default' && !search && !category && !subcategory");
    expect(src).toContain("!!Astro.locals.gpVisit");
    expect(src).toContain("Show the standard order");
    expect(src).toContain("if (personalLead) Astro.response.headers.set('Cache-Control', 'private, no-store')");
  });
});
