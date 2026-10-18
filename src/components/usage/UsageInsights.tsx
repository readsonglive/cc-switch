import { useTranslation } from "react-i18next";
import { deriveInsights } from "./insights";
import { useModelStats, useUsageTrends } from "@/lib/query/usage";
import { cn } from "@/lib/utils";
import type { UsageRangeSelection } from "@/types/usage";

interface UsageInsightsProps {
  range: UsageRangeSelection;
  appType?: string;
  providerName?: string;
  model?: string;
  compact?: boolean;
}

function MiniMetric({
  label,
  value,
  sub,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  title?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-panel bg-subtle px-3.5 py-2">
      <div className="flex min-w-0 items-center gap-0.5">
        <span className="truncate text-caption text-fg-2">{label}</span>
      </div>
      <span
        className="truncate text-section tabular-nums text-fg-1"
        title={title}
      >
        {value}
      </span>
      {sub && <span className="text-caption text-fg-3">{sub}</span>}
    </div>
  );
}

export function UsageInsights({
  range,
  appType,
  providerName,
  model,
  compact,
}: UsageInsightsProps) {
  const { t } = useTranslation();

  const { data: modelStats } = useModelStats(range, {
    appType,
    providerName,
    model,
  });
  // 第四格用固定 14d 范围，独立于页面时间范围
  const { data: trends14d } = useUsageTrends(
    { preset: "14d" as const },
    { appType, providerName, model },
  );

  const insights = deriveInsights(modelStats ?? []);

  // 近 7 日 vs 前 7 日环比
  const weekOverWeekLabel = (() => {
    if (!trends14d || trends14d.length === 0) return null;
    const sorted = [...trends14d].sort((a, b) => a.date.localeCompare(b.date));
    const mid = sorted[Math.floor(sorted.length / 2)]?.date;
    if (!mid) return null;
    const current = sorted.filter((d) => d.date >= mid);
    const previous = sorted.filter((d) => d.date < mid);
    const curTokens = current.reduce((s, d) => s + d.totalTokens, 0);
    const prevTokens = previous.reduce((s, d) => s + d.totalTokens, 0);
    if (prevTokens === 0)
      return curTokens > 0 ? t("usage.insights.newModel") : null;
    const delta = ((curTokens - prevTokens) / prevTokens) * 100;
    return `${delta > 0 ? "+" : ""}${delta.toFixed(0)}%`;
  })();

  return (
    <section
      aria-label={t("usage.insights.label")}
      className={cn("grid gap-2.5", compact ? "grid-cols-2" : "grid-cols-4")}
    >
      {insights.map((ins) => (
        <MiniMetric
          key={ins.id}
          label={ins.title}
          value={ins.highlight || "—"}
          sub={ins.body}
          title={ins.body}
        />
      ))}
      <MiniMetric
        label={t("usage.insights.weekOverWeek")}
        value={weekOverWeekLabel ?? "—"}
        title={t("usage.insights.weekOverWeekHelp")}
      />
    </section>
  );
}
