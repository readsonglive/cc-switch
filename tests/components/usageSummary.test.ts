import { describe, expect, it } from "vitest";
import {
  aggregateSummaries,
  pickSummary,
} from "@/components/usage/usageSummary";
import type { UsageSummary } from "@/types/usage";

const summary = (over: Partial<UsageSummary> = {}): UsageSummary => ({
  totalRequests: 10,
  totalCost: "0.1",
  totalInputTokens: 600_000,
  totalOutputTokens: 400_000,
  totalCacheCreationTokens: 100_000,
  totalCacheReadTokens: 200_000,
  successRate: 99,
  realTotalTokens: 1_300_000,
  cacheHitRate: 200_000 / 1_300_000,
  ...over,
});

describe("aggregateSummaries", () => {
  it("多项求和", () => {
    const a = summary({ totalInputTokens: 100, totalOutputTokens: 50 });
    const b = summary({ totalInputTokens: 200, totalOutputTokens: 100 });
    const r = aggregateSummaries([a, b]);
    expect(r.totalInputTokens).toBe(300);
    expect(r.totalOutputTokens).toBe(150);
  });

  it("空输入返回零化 summary", () => {
    const r = aggregateSummaries([]);
    expect(r).toMatchObject({
      totalRequests: 0,
      totalCost: "0.000000",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cacheHitRate: 0,
    });
  });
});

describe("pickSummary", () => {
  it("单条目直接返回", () => {
    const s = summary();
    expect(pickSummary([{ appType: "app1", summary: s }], "app1")).toBe(s);
  });

  it("多条目取第一条（上游已聚合）", () => {
    const a = summary();
    const b = summary();
    expect(
      pickSummary(
        [
          { appType: "a", summary: a },
          { appType: "b", summary: b },
        ],
        "any",
      ),
    ).toBe(a);
  });
});
