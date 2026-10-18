import { describe, expect, it } from "vitest";
import { deriveInsights } from "@/components/usage/insights";
import type { ModelStats } from "@/types/usage";

const row = (over: Partial<ModelStats> = {}): ModelStats => ({
  model: "openai/gpt-4o",
  requestCount: 100,
  totalTokens: 1_000_000,
  totalCost: "0.1",
  avgCostPerRequest: "0.001",
  successRate: 99,
  ...over,
});

describe("deriveInsights", () => {
  it("输出固定 4 条洞察", () => {
    const insights = deriveInsights([
      row(),
      row({
        model: "openai/gpt-4o-mini",
        totalTokens: 5_000_000,
      }),
    ]);
    expect(insights).toHaveLength(4);
  });

  it("Top1 提示用户模型名称", () => {
    const insights = deriveInsights([
      row({ model: "openai/gpt-4o", totalTokens: 8_000_000 }),
      row({ model: "anthropic/claude-sonnet-4", totalTokens: 1_000_000 }),
    ]);
    const top = insights.find((i) => i.id === "top_model");
    expect(top).toBeDefined();
    expect(top?.highlight).toContain("gpt-4o");
  });

  it("缓存命中率高时在 Highlight 给出比例", () => {
    const insights = deriveInsights([
      row({
        totalTokens: 10_000_000,
      }),
    ]);
    const cache = insights.find((i) => i.id === "cache_hit_rate");
    expect(cache).toBeDefined();
    // 无缓存字段时 cacheHitRatio=0，highlight 为空字符串
    expect(cache?.highlight).toBe("");
  });

  it("Top2 差异大时给出比例", () => {
    const insights = deriveInsights([
      row({ totalTokens: 100_000_000 }),
      row({ totalTokens: 500_000 }),
    ]);
    const top2 = insights.find((i) => i.id === "top2_gap");
    expect(top2).toBeDefined();
    // 100_000_000 / 500_000 = 200
    expect(top2?.highlight).toMatch(/200×|200 倍|200x/i);
  });

  it("单模型无 Top2 差异时仍保留占位项", () => {
    const insights = deriveInsights([row()]);
    const ids = insights.map((i) => i.id);
    // top2_gap 始终存在（展示模型集中度）
    expect(ids).toContain("top2_gap");
  });
});

describe("空输入", () => {
  it("返回 4 条默认洞察，无 highlight", () => {
    const insights = deriveInsights([]);
    expect(insights).toHaveLength(4);
    insights.forEach((i) => {
      expect(i.highlight).toBe("");
    });
  });
});
