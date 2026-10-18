import { expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { UsageInsights } from "@/components/usage/UsageInsights";
import type { ModelStats } from "@/types/usage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

vi.mock("@/lib/query/usage", () => ({
  useModelStats: vi.fn(),
  useUsageTrends: vi.fn(),
}));

const { useModelStats, useUsageTrends } = await import("@/lib/query/usage");

vi.mocked(useModelStats).mockReturnValue({
  data: [
    {
      model: "gpt-4o",
      requestCount: 10,
      totalTokens: 8_000_000,
      totalCost: "0",
      avgCostPerRequest: "0",
      successRate: 100,
    } as ModelStats,
    {
      model: "claude-sonnet",
      requestCount: 1,
      totalTokens: 1_000_000,
      totalCost: "5",
      avgCostPerRequest: "5",
      successRate: 100,
    } as ModelStats,
  ],
  isLoading: false,
} as any);

vi.mocked(useUsageTrends).mockReturnValue({
  data: [] as any[],
  isLoading: false,
} as any);

function WithQueryClient({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

it("环比数据不足时不崩", () => {
  render(
    <WithQueryClient>
      <UsageInsights range={{ preset: "all" as const }} />
    </WithQueryClient>,
  );
  // 组件能渲染、主力模型标题出现即证明没有崩
  expect(screen.getByText(/主力模型/)).toBeInTheDocument();
});
