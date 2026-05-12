import { describe, expect, it } from "vitest";
import { ProductSignalExtractor } from "../../apps/api/src/application/recommendations/ProductSignalExtractor";

describe("ProductSignalExtractor", () => {
  const extractor = new ProductSignalExtractor();

  it("extracts wall charger USB-C PD wattage signals from name", () => {
    const signals = extractor.extract({
      id: "p1",
      slug: "goldplus-65w-fast-charger-usb-c-pd",
      name: "GoldPlus 65W Fast Charger USB-C PD",
      description: "Fast charger for modern devices",
      imageUrl: "/x.jpg",
      isActive: true,
      stockStatus: "in_stock",
    });

    expect(signals.productType).toBe("wall_charger");
    expect(signals.wattage).toBe(65);
    expect(signals.connectorTypes).toContain("usb_c");
    expect(signals.protocols).toContain("PD");
  });

  it("matches generic connector and protocol strings exactly per requirement list", () => {
    const t1 = extractor.extract({ id: "t1", slug: "x", name: "GoldPlus Car Charger PD30W + QC4.0", isActive: true });
    expect(t1.productType).toBe("car_charger");
    expect(t1.wattage).toBe(30);
    expect(t1.protocols).toContain("PD");
    expect(t1.protocols).toContain("QC4.0");

    const t2 = extractor.extract({ id: "t2", slug: "x", name: "GoldPlus 100W USB-C Fast Charging Cable", isActive: true });
    expect(t2.productType).toBe("cable");
    expect(t2.wattage).toBe(100);
    expect(t2.connectorTypes).toContain("usb_c");

    const t3 = extractor.extract({ id: "t3", slug: "x", name: "GoldPlus Power Bank 20000mAh Type-C", isActive: true });
    expect(t3.productType).toBe("power_bank");
    expect(t3.capacity).toBe(20000);
    expect(t3.connectorTypes).toContain("usb_c");

    const t4 = extractor.extract({ id: "t4", slug: "x", name: "GoldPlus Type-C Fast Charging Cable 3A", isActive: true });
    expect(t4.productType).toBe("cable");
    expect(t4.amperage).toBe(3);
  });

  it("identifies non-cabled formats correctly", () => {
    const earbuds = extractor.extract({
      id: "eb1",
      slug: "eb-slug",
      name: "GoldPlus Open-Style Wireless Buds",
      isActive: true,
    });
    expect(earbuds.productType).toBe("earbuds");
    expect(earbuds.connectorTypes).toContain("wireless");

    const micro = extractor.extract({
      id: "micro1",
      slug: "micro-slug",
      name: "GoldPlus Micro USB Cable",
      isActive: true,
    });
    expect(micro.connectorTypes).toContain("micro_usb");

    const lightning = extractor.extract({
      id: "lt1",
      slug: "lightning-slug",
      name: "GoldPlus Lightning Cable",
      isActive: true,
    });
    expect(lightning.connectorTypes).toContain("lightning");
  });
});
