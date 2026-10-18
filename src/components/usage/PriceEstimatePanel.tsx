import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpTip } from "@/components/ui/help-tip";
import { useMoneyFormat } from "@/hooks/useMoneyFormat";
import {
  estimateAll,
  type TokenBreakdown,
} from "@/components/usage/estimateCost";
import { pickSummary } from "@/components/usage/usageSummary";
import {
  useModelPricing,
  useModelStats,
  useUsageSummaryByApp,
} from "@/lib/query/usage";
import { cn } from "@/lib/utils";
import type { UsageRangeSelection } from "@/types/usage";

interface PriceEstimatePanelProps {
  range: UsageRangeSelection;
  appType?: string;
  providerName?: string;
  model?: string;
  compact?: boolean;
}

/** 首次有数据时初始化选中项，之后不覆盖用户选择 */
function useDefaultSelected(
  pricing: import("@/types/usage").ModelPricing[],
  modelStats: Array<{ model: string; requestCount: number }>,
): {
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
} {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current || pricing.length === 0) return;
    initializedRef.current = true;

    // 用 requestCount 降序取前 5 个模型名与定价表求交
    const topModels = [...modelStats]
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, 5)
      .map((m) => m.model);
    const matching = pricing.filter(
      (p) => topModels.includes(p.modelId) || topModels.includes(p.displayName),
    );
    if (matching.length > 0) {
      setSelectedIds(matching.map((p) => p.modelId));
      return;
    }
    // 回落：取定价表前 5 个
    setSelectedIds(pricing.slice(0, 5).map((p) => p.modelId));
  }, [pricing, modelStats]);

  return { selectedIds, setSelectedIds };
}

export function PriceEstimatePanel({
  range,
  appType,
  providerName,
  model,
}: PriceEstimatePanelProps) {
  const { t } = useTranslation();
  const { money, moneyTitle } = useMoneyFormat();

  const { data: pricingData } = useModelPricing();
  const { data: statsData } = useModelStats(range, {
    appType,
    providerName,
    model,
  });
  const { data: summaryByApp } = useUsageSummaryByApp(
    range,
    { providerName, model },
    { refetchInterval: false },
  );

  const pricing = pricingData ?? [];
  const stats = statsData ?? [];
  const summary = pickSummary(summaryByApp ?? [], appType);

  const tokens: TokenBreakdown = summary
    ? {
        input: summary.totalInputTokens,
        output: summary.totalOutputTokens,
        cacheWrite: summary.totalCacheCreationTokens,
        cacheRead: summary.totalCacheReadTokens,
      }
    : { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

  const { selectedIds, setSelectedIds } = useDefaultSelected(pricing, stats);
  const [open, setOpen] = useState(false);

  // 估算结果
  const estimates = estimateAll(tokens, pricing);
  const selected = estimates.filter((e) => selectedIds.includes(e.modelId));
  const maxCost =
    selected.length > 0 ? Math.max(...selected.map((e) => e.costUsd)) : 0;
  const cheapest =
    selected.length > 0
      ? selected.reduce((a, b) => (a.costUsd < b.costUsd ? a : b))
      : null;
  const savings =
    cheapest && maxCost > 0
      ? Math.round((1 - cheapest.costUsd / maxCost) * 100)
      : 0;

  if (pricing.length === 0) {
    return (
      <section
        aria-label={t("usage.estimate.title")}
        className="flex flex-col gap-2"
      >
        <div className="flex items-center gap-2">
          <span className="text-strong font-semibold text-fg-1">
            {t("usage.estimate.title")}
          </span>
          <HelpTip title={t("usage.estimate.title")} align="start">
            {t("usage.estimate.emptyPricing")}
          </HelpTip>
        </div>
        <p className="text-caption text-fg-3">
          {t("usage.estimate.emptyPricing")}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label={t("usage.estimate.title")}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <span className="text-strong font-semibold text-fg-1">
          {t("usage.estimate.title")}
        </span>
        <HelpTip title={t("usage.estimate.title")} align="start">
          {t("usage.estimate.pickHint")}
        </HelpTip>
      </div>

      {/* 多选框 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "flex h-7 w-full items-center justify-between gap-2 rounded-control border border-border bg-surface px-2.5 text-caption text-fg-2 transition-colors hover:bg-subtle",
          )}
        >
          <span>{t("usage.estimate.pickModels")}</span>
          <span className="text-fg-3">
            {selected.length > 0 ? `${selected.length} selected` : ""}
          </span>
        </button>
        {open && (
          <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-panel border border-border bg-surface shadow-v7-md">
            <div className="sticky top-0 border-b border-border bg-surface p-2">
              <input
                type="text"
                placeholder={t("common.search")}
                className="w-full rounded-control border border-border bg-subtle px-2 py-1 text-caption text-fg-1 outline-none focus:border-ring"
                autoFocus
              />
            </div>
            {pricing.map((p) => {
              const checked = selectedIds.includes(p.modelId);
              return (
                <label
                  key={p.modelId}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-subtle"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setSelectedIds((prev: string[]) =>
                        e.target.checked
                          ? [...prev, p.modelId]
                          : prev.filter((id: string) => id !== p.modelId),
                      );
                    }}
                    className="h-3.5 w-3.5 rounded border-border"
                  />
                  <span className="truncate text-caption text-fg-1">
                    {p.displayName}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* 结果表格 */}
      {selected.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {/* 摘要行 */}
          {cheapest && maxCost > 0 && (
            <div className="flex items-center gap-2 text-caption text-fg-2">
              <span>{t("usage.estimate.cheapest")}: </span>
              <span className="font-medium text-fg-1">
                {cheapest.displayName}
              </span>
              <span>{money(cheapest.costUsd, 4)}</span>
              <span>·</span>
              <span className="text-action">
                {t("usage.estimate.saves", { percent: savings })}
              </span>
            </div>
          )}
          {/* 表格 */}
          <div className="overflow-hidden rounded-panel border border-border">
            <table className="w-full text-caption">
              <thead>
                <tr className="border-b border-border bg-subtle">
                  <th className="px-3 py-1.5 text-start font-medium text-fg-2">
                    {t("usage.estimate.model")}
                  </th>
                  <th className="px-3 py-1.5 text-end font-medium text-fg-2">
                    {t("usage.estimate.cost")}
                  </th>
                  <th className="w-32 px-3 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {selected.map((e) => (
                  <tr
                    key={e.modelId}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{e.displayName}</span>
                        {!e.hasCachePricing && (
                          <span
                            className="shrink-0 text-xs text-warning"
                            title={t("usage.estimate.noCachePrice")}
                          >
                            ⚠
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-end tabular-nums">
                      <span title={moneyTitle(e.costUsd, 6)}>
                        {money(e.costUsd, 4)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      {maxCost > 0 && (
                        <div className="h-1.5 w-full rounded-full bg-subtle">
                          <div
                            className="h-1.5 rounded-full bg-action"
                            style={{
                              width: `${(e.costUsd / maxCost) * 100}%`,
                            }}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-caption text-fg-3">{t("usage.estimate.pickHint")}</p>
      )}
    </section>
  );
}
