import { expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { GlobalRankingsPanel } from "@/components/usage/GlobalRankingsPanel";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

vi.mock("@/lib/query/usage", () => ({
  useOpenRouterRankings: vi.fn(),
  usageKeys: { openrouterRankings: vi.fn() },
}));

const { useOpenRouterRankings } = await import("@/lib/query/usage");

const row = (date: string, model: string, totalTokens: number) => ({
  date,
  model,
  totalTokens,
});

const ok = (rows = [
  row("2026-10-10", "openai/gpt-4o", 100),
  row("2026-10-10", "anthropic/claude", 50),
]) =>
  ({
    data: { status: "ok", asOf: "2026-10-15", rows } as any,
    isLoading: false,
    error: null,
  }) as any;

function WithQueryClient({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

it("正常态渲染模型榜", () => {
  vi.mocked(useOpenRouterRankings).mockReturnValue(ok());
  render(
    <WithQueryClient>
      <GlobalRankingsPanel />
    </WithQueryClient>,
  );
  expect(screen.getByText("gpt-4o")).toBeInTheDocument();
});

it("no_key 时给出配置引导", () => {
  vi.mocked(useOpenRouterRankings).mockReturnValue(
    {
      data: { status: "no_key", rows: [] } as any,
      isLoading: false,
      error: null,
    } as any,
  );
  render(
    <WithQueryClient>
      <GlobalRankingsPanel />
    </WithQueryClient>,
  );
  expect(screen.getByText("usage.global.noKey")).toBeInTheDocument();
});

it("底部始终显示 OpenRouter 署名链接", () => {
  vi.mocked(useOpenRouterRankings).mockReturnValue(ok());
  render(
    <WithQueryClient>
      <GlobalRankingsPanel />
    </WithQueryClient>,
  );
  const link = screen.getByRole("link", { name: /openrouter\.ai\/rankings/i });
  expect(link).toHaveAttribute("href", "https://openrouter.ai/rankings");
});
