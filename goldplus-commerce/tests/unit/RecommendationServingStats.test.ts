import { beforeEach, describe, expect, it, vi } from "vitest";

const executed: string[] = [];
let failNext = 0;
let gate: Promise<void> | null = null;

vi.mock("../../apps/api/src/infrastructure/db/client", () => ({
  db: {
    execute: async (q: { queryChunks?: unknown[] }) => {
      if (gate) await gate;
      if (failNext > 0) { failNext -= 1; throw new Error("db down"); }
      executed.push(JSON.stringify(q.queryChunks ?? q));
    },
  },
}));

import { RecommendationServingStats } from "../../apps/api/src/infrastructure/recommendations/RecommendationServingStats";

const at = (iso: string) => new Date(iso);
const held = (s: RecommendationServingStats) =>
  [...(s as unknown as { buckets: Map<string, { responses: number }> }).buckets.entries()];

describe("serving counter — documented loss/duplication model", () => {
  beforeEach(() => { executed.length = 0; failNext = 0; gate = null; });

  it("one row per (hour, placement); an hour boundary splits buckets by EVENT time", async () => {
    const s = new RecommendationServingStats(() => {}, 3_600_000);
    s.record({ placement: "home_trending", empty: false, fallbackServed: false, at: at("2026-09-20T10:59:59Z") });
    s.record({ placement: "home_trending", empty: true, fallbackServed: true, at: at("2026-09-20T11:00:00Z") });
    s.record({ placement: "home_trending", empty: false, fallbackServed: false, at: at("2026-09-20T11:30:00Z") });
    expect(held(s).map(([k, b]) => [k, b.responses])).toEqual([
      ["2026-09-20T10:00:00.000Z|home_trending", 1],
      ["2026-09-20T11:00:00.000Z|home_trending", 2],
    ]);
    await s.flush();
    expect(executed.length).toBe(2);
    expect(held(s).length).toBe(0);
    await s.stop(10);
  });

  it("serves arriving DURING a flush are not lost and do not mutate the in-flight batch", async () => {
    const s = new RecommendationServingStats(() => {}, 3_600_000);
    let open!: () => void;
    gate = new Promise<void>((r) => { open = r; });
    const now = new Date();
    s.record({ placement: "pdp_related", empty: false, fallbackServed: false, at: now });
    const flushing = s.flush();
    s.record({ placement: "pdp_related", empty: false, fallbackServed: false, at: now });
    open(); gate = null;
    await flushing;
    expect(executed.length).toBe(1);
    expect(held(s)[0][1].responses).toBe(1);
    await s.stop(10);
  });

  it("a failed write is retained and retried, never silently dropped; the failure is reported", async () => {
    const reports: Array<{ retained: number; droppedResponses: number }> = [];
    const s = new RecommendationServingStats((_e, h) => reports.push(h), 3_600_000);
    s.record({ placement: "cart_addon", empty: false, fallbackServed: false, at: new Date() });
    failNext = 1;
    await s.flush();
    expect(reports).toEqual([{ retained: 1, droppedResponses: 0 }]);
    expect(held(s)[0][1].responses).toBe(1);
    await s.flush();
    expect(executed.length).toBe(1);
    await s.stop(10);
  });

  it("an outage is bounded: hours older than the cap are dropped and the drop is counted", async () => {
    const reports: Array<{ retained: number; droppedResponses: number }> = [];
    const s = new RecommendationServingStats((_e, h) => reports.push(h), 3_600_000);
    s.record({ placement: "cart_addon", empty: false, fallbackServed: false, at: new Date(Date.now() - 8 * 3_600_000) });
    failNext = 1;
    await s.flush();
    expect(reports[0].droppedResponses).toBe(1);
    expect(held(s).length).toBe(0);
    await s.stop(10);
  });

  it("shutdown never hangs on a dead database", async () => {
    const s = new RecommendationServingStats(() => {}, 3_600_000);
    gate = new Promise<void>(() => {});
    s.record({ placement: "cart_addon", empty: false, fallbackServed: false, at: new Date() });
    const t0 = Date.now();
    await s.stop(50);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
