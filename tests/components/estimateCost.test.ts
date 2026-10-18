import { describe, expect, it } from "vitest";
import {
  estimateAll,
  estimateModelCost,
} from "@/components/usage/estimateCost";
import type { ModelPricing } from "@/types/usage";

const pricing = (over: Partial<ModelPricing> = {}): ModelPricing => ({
  modelId: "m1",
  displayName: "M1",
  inputCostPerMillion: "1",
  outputCostPerMillion: "2",
  cacheReadCostPerMillion: "0.1",
  cacheCreationCostPerMillion: "1.5",
  ...over,
});

describe("estimateModelCost", () => {
  it("按四项单价分别乘除以百万", () => {
    const r = estimateModelCost(
      {
        input: 1_000_000,
        output: 500_000,
        cacheWrite: 200_000,
        cacheRead: 3_000_000,
      },
      pricing(),
    );
    // 1*1 + 0.5*2 + 0.2*1.5 + 3*0.1 = 1 + 1 + 0.3 + 0.3 = 2.6
    expect(r.costUsd).toBeCloseTo(2.6, 10);
    expect(r.hasCachePricing).toBe(true);
  });

  it("缓存单价缺失时按 0 计并标记", () => {
    const r = estimateModelCost(
      {
        input: 1_000_000,
        output: 0,
        cacheWrite: 5_000_000,
        cacheRead: 5_000_000,
      },
      pricing({
        cacheReadCostPerMillion: "",
        cacheCreationCostPerMillion: "",
      }),
    );
    expect(r.costUsd).toBeCloseTo(1, 10);
    expect(r.hasCachePricing).toBe(false);
  });

  it("单价是坏值时按 0，不产生 NaN", () => {
    const r = estimateModelCost(
      { input: 1_000_000, output: 1_000_000, cacheWrite: 0, cacheRead: 0 },
      pricing({
        inputCostPerMillion: "abc",
        outputCostPerMillion: "-2",
      }),
    );
    // 负单价视为非法（定价表里不应有负价格），按 0 计；两项都坏 = 0
    expect(r.costUsd).toBe(0);
    expect(Number.isNaN(r.costUsd)).toBe(false);
  });
});

describe("estimateAll", () => {
  it("按 modelId 匹配；没命中时回落到定价表前 5 个", () => {
    const m2 = pricing({ modelId: "m2" });
    const result = estimateAll(
      { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 },
      [pricing(), m2],
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.modelId)).toEqual(["m1", "m2"]);
  });

  it("token 合计为 0 的行不进入结果", () => {
    const result = estimateAll(
      { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
      [pricing()],
    );
    expect(result).toHaveLength(0);
  });

  it("没有定价表时返回空数组", () => {
    expect(
      estimateAll({ input: 1, output: 0, cacheWrite: 0, cacheRead: 0 }, []),
    ).toHaveLength(0);
  });
});
