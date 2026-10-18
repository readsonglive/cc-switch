import { expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { PriceEstimatePanel } from "@/components/usage/PriceEstimatePanel";
import type { UsageSummary } from "@/types/usage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

vi.mock("@/lib/query/usage", () => ({
  useModelPricing: vi.fn(),
  useModelStats: vi.fn(),
  useUsageSummaryByApp: vi.fn(),
}));

const { useModelPricing, useModelStats, useUsageSummaryByApp } = await import(
  "@/lib/query/usage"
);

vi.mocked(useModelPricing).mockReturnValue({
  data: [
    { modelId: "cheap", displayName: "Cheap", inputCostPerMillion: "1", outputCostPerMillion: "0", cacheReadCostPerMillion: "0", cacheCreationCostPerMillion: "0" },
    { modelId: "pricey", displayName: "Pricey", inputCostPerMillion: "3", outputCostPerMillion: "0", cacheReadCostPerMillion: "0", cacheCreationCostPerMillion: "0" },
  ],
  isLoading: false,
} as any);

vi.mocked(useModelStats).mockReturnValue({
  data: [
    { model: "cheap", requestCount: 10 },
    { model: "pricey", requestCount: 5 },
  ],
  isLoading: false,
} as any);

vi.mocked(useUsageSummaryByApp).mockReturnValue({
  data: [
    {
      appType: "claude",
      summary: {
        totalRequests: 0,
        totalCost: "0",
        totalInputTokens: 1_000_000,
        totalOutputTokens: 0,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        successRate: 0,
        realTotalTokens: 1_000_000,
        cacheHitRate: 0,
      } as UsageSummary,
    },
  ],
  isLoading: false,
} as any);

function WithQueryClient({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

it("渲染估算价格标题", () => {
  render(
    <WithQueryClient>
      <PriceEstimatePanel range={{ preset: "all" as const }} appType="claude" />
    </WithQueryClient>,
  );
  expect(screen.getByText("usage.estimate.title")).toBeInTheDocument();
});

it("显示选择模型入口", () => {
  render(
    <WithQueryClient>
      <PriceEstimatePanel range={{ preset: "all" as const }} appType="claude" />
    </WithQueryClient>,
  );
  expect(screen.getByText("usage.estimate.pickModels")).toBeInTheDocument();
});
