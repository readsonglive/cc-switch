import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useOpenRouterRankings } from "@/lib/query/usage";
import { usageKeys } from "@/lib/query/usage";
import {
  formatTokensCompact,
  getLocaleFromLanguage,
  getResolvedLang,
} from "./format";
import {
  modelLeaderboard,
  authorShares,
  type RankingsPeriod,
} from "./rankings";
import { cn } from "@/lib/utils";

function StatusBanner({
  status,
  message,
}: {
  status?: string;
  message?: string;
}) {
  const { t } = useTranslation();
  if (status === "no_key") {
    return (
      <div className="flex flex-col gap-2 rounded-panel border border-border bg-subtle p-4 text-caption">
        <p className="text-fg-1">{t("usage.global.noKey")}</p>
        <p className="text-fg-3">{t("usage.global.noKeyHint")}</p>
      </div>
    );
  }
  if (status === "unauthorized") {
    return (
      <div className="rounded-panel border border-danger/30 bg-danger/5 p-4 text-caption text-fg-1">
        {message ?? t("usage.global.unauthorized")}
      </div>
    );
  }
  if (status === "api_error") {
    return (
      <div className="rounded-panel border border-warning/30 bg-warning/5 p-4 text-caption text-fg-1">
        {message ?? t("usage.global.apiError")}
      </div>
    );
  }
  return null;
}

export function GlobalRankingsPanel() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const locale = getLocaleFromLanguage(getResolvedLang(i18n));
  const [period, setPeriod] = useState<RankingsPeriod>("week");

  const { data, isLoading, error } = useOpenRouterRankings(period);

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: usageKeys.openrouterRankings(period),
    });
  };

  const leaderboard = data ? modelLeaderboard(data.rows, period) : [];
  const shares = data ? authorShares(data.rows, period) : [];

  return (
    <div className="flex flex-col gap-3">
      {/* 顶部控制条 */}
      <div className="flex items-center gap-2">
        <SegmentedControl<RankingsPeriod>
          aria-label={t("usage.global.period")}
          items={[
            { value: "week", label: t("usage.global.periodWeek") },
            { value: "month", label: t("usage.global.periodMonth") },
          ]}
          value={period}
          onValueChange={(v) => setPeriod(v)}
        />
        <div className="flex-1" />
        <button
          type="button"
          onClick={refresh}
          disabled={isLoading}
          className="inline-flex h-7 items-center gap-1 rounded-control px-2 text-caption text-fg-2 transition-colors hover:bg-subtle hover:text-fg-1 disabled:opacity-50"
          aria-label={t("common.refresh")}
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
          />
          <span>{t("common.refresh")}</span>
        </button>
        {data?.asOf && (
          <span className="text-caption text-fg-3">
            {t("usage.global.asOf", { date: data.asOf.slice(0, 10) })}
          </span>
        )}
      </div>

      {/* 错误/状态提示（有 data 时额外显示，不遮挡榜单） */}
      {data && data.status !== "ok" && (
        <StatusBanner status={data.status} message={data.message} />
      )}
      {error && !data && (
        <div className="rounded-panel border border-danger/30 bg-danger/5 p-3 text-caption text-fg-1">
          {t("usage.global.fetchFailed")}
        </div>
      )}

      {/* 加载中 */}
      {isLoading && !data && (
        <div className="flex h-32 items-center justify-center text-caption text-fg-3">
          {t("common.loading")}
        </div>
      )}

      {/* 模型榜 */}
      {data && leaderboard.length > 0 && (
        <div className="overflow-hidden rounded-panel border border-border">
          <table className="w-full text-caption">
            <thead>
              <tr className="border-b border-border bg-subtle">
                <th className="w-8 px-3 py-1.5"></th>
                <th className="px-3 py-1.5 text-start font-medium text-fg-2">
                  {t("usage.global.model")}
                </th>
                <th className="px-3 py-1.5 text-start font-medium text-fg-2">
                  {t("usage.global.author")}
                </th>
                <th className="px-3 py-1.5 text-end font-medium text-fg-2">
                  {t("usage.global.tokens")}
                </th>
                <th className="px-3 py-1.5 text-end font-medium text-fg-2">
                  {t("usage.global.delta")}
                </th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, idx) => {
                const rank = idx + 1;
                const isTop3 = rank <= 3;
                return (
                  <tr
                    key={row.model}
                    className="border-b border-border last:border-0 hover:bg-subtle"
                  >
                    <td className="px-3 py-1.5 text-center">
                      {isTop3 ? (
                        <span
                          className={cn(
                            "inline-flex h-5 w-5 items-center justify-center rounded-full text-badge font-semibold",
                            rank === 1
                              ? "bg-yellow-400/20 text-yellow-700"
                              : rank === 2
                                ? "bg-gray-300/30 text-gray-600"
                                : "bg-orange-300/30 text-orange-700",
                          )}
                        >
                          {rank}
                        </span>
                      ) : (
                        <span className="text-fg-3">{rank}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <span title={row.model} className="font-medium text-fg-1">
                        {row.label}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-fg-3">{row.author}</td>
                    <td className="px-3 py-1.5 text-end tabular-nums">
                      <span title={row.tokens.toString()}>
                        {formatTokensCompact(row.tokens, locale)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-end">
                      {row.deltaPct == null
                        ? row.isNew
                          ? t("usage.global.new")
                          : "—"
                        : row.deltaPct > 0
                          ? `+${row.deltaPct.toFixed(0)}%`
                          : `${row.deltaPct.toFixed(0)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 厂商份额 */}
      {data && shares.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-strong text-fg-1">
            {t("usage.global.vendorShare")}
          </h4>
          {shares.map((s) => (
            <div key={s.author} className="flex items-center gap-3">
              <span className="w-24 truncate text-caption text-fg-2">
                {s.author}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-subtle">
                <div
                  className="h-1.5 rounded-full bg-action"
                  style={{ width: `${s.share * 100}%` }}
                />
              </div>
              <span className="w-16 text-end text-caption tabular-nums text-fg-3">
                {(s.share * 100).toFixed(1)}%
              </span>
              <span className="w-20 text-end text-caption tabular-nums text-fg-3">
                {formatTokensCompact(s.tokens, locale)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 底部署名（英文原文，CC BY 4.0 要求） */}
      {data && (
        <p className="text-caption text-fg-3">
          Source: OpenRouter (
          <a
            href="https://openrouter.ai/rankings"
            target="_blank"
            rel="noopener noreferrer"
            className="text-action hover:underline"
          >
            openrouter.ai/rankings
          </a>
          ), as of {data.asOf?.slice(0, 10) ?? "—"}.
        </p>
      )}
    </div>
  );
}
