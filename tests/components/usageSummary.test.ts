import { describe, expect, it } from "vitest";
import { aggregateSummaries, pickSummary } from "@/components/usage/usageSummary";
import type { UsageSummary, UsageSummaryByApp } from "@/types/usage";

const A: UsageSummary = {
  totalRequests: 10,
  totalCost: "1.5",
  totalInputTokens: 100,
  totalOutputTokens: 50,
  totalCacheCreationTokens: 20,
  totalCacheReadTokens: 30,
  successRate: 90,
  realTotalTokens: 200,
  cacheHitRate: 0.2,
};
const B: UsageSummary = {
  totalRequests: 30,
  totalCost: "2.5",
  totalInputTokens: 300,
  totalOutputTokens: 100,
  totalCacheCreationTokens: 0,
  totalCacheReadTokens: 200,
  successRate: 100,
  realTotalTokens: 600,
  cacheHitRate: 0.4,
};
const apps: UsageSummaryByApp[] = [
  { appType: "claude", summary: A },
  { appType: "codex", summary: B },
];

it("不传 appType 时把各应用逐项相加", () => {
  const r = pickSummary(apps, undefined)!;
  expect(r.totalRequests).toBe(40);
  expect(r.totalInputTokens).toBe(400);
  expect(r.totalOutputTokens).toBe(150);
  expect(r.totalCacheCreationTokens).toBe(20);
  expect(r.totalCacheReadTokens).toBe(230);
  expect(r.realTotalTokens).toBe(800);
  expect(r.totalCost).toBe("4.000000");
});

it("successRate / cacheHitRate 按求和后重算，而不是跨行取平均", () => {
  const r = pickSummary(apps, undefined)!;
  // (10*0.9 + 30*1.0) / 40 * 100 = 97.5
  expect(r.successRate).toBeCloseTo(97.5, 10);
  // cacheHitRate = 230 / (400 + 20 + 230) = 230/650
  expect(r.cacheHitRate).toBeCloseTo(230 / 650, 10);
});

it("传 appType 时只取该应用，不做合并", () => {
  expect(pickSummary(apps, "codex")).toBe(B);
});

it("appType 无匹配 / 空数组时返回 undefined", () => {
  expect(pickSummary(apps, "nope")).toBeUndefined();
  expect(pickSummary([], undefined)).toBeUndefined();
});

it("aggregateSummaries 空数组时不产生 NaN", () => {
  const r = aggregateSummaries([]);
  expect(r.totalRequests).toBe(0);
  expect(r.successRate).toBe(0);
  expect(r.cacheHitRate).toBe(0);
});
