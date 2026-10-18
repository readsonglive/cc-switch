export interface InsightItem {
  id: string;
  title: string;
  body: string;
  highlight: string;
  variant: "neutral" | "positive" | "negative" | "info";
}

/** 一条 model-stats 口径的「模型用量行」：只取洞察需要用到的字段。 */
interface ModelRow {
  model: string;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/**
 * 个人使用量洞察：4 格，按输入/输出/缓存/Top 模型分布推导。
 *
 * 输入：ModelStats[]（来自 `useModelStats`）；没有数据时回退到占位文案。
 */
export function deriveInsights(
  modelSummaries: readonly ModelRow[],
): InsightItem[] {
  const totalTokens = modelSummaries.reduce(
    (acc, s) => acc + (s.totalTokens ?? 0),
    0,
  );
  const totalInput = modelSummaries.reduce(
    (acc, s) => acc + (s.inputTokens ?? 0),
    0,
  );
  const totalOutput = modelSummaries.reduce(
    (acc, s) => acc + (s.outputTokens ?? 0),
    0,
  );
  const totalCacheRead = modelSummaries.reduce(
    (acc, s) => acc + (s.cacheReadTokens ?? 0),
    0,
  );
  const totalCacheWrite = modelSummaries.reduce(
    (acc, s) => acc + (s.cacheCreationTokens ?? 0),
    0,
  );

  const sorted = [...modelSummaries].sort(
    (a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0),
  );
  const top = sorted[0];
  const top2 = sorted[1];

  const topModel = top
    ? `「${top.model.split("/").at(-1) ?? top.model}」`
    : "";
  const topRatio =
    totalTokens > 0 ? ((top?.totalTokens ?? 0) / totalTokens).toFixed(2) : "0";
  const cacheHitRatio =
    totalInput + totalCacheWrite + totalCacheRead > 0
      ? (totalCacheRead / (totalInput + totalCacheWrite + totalCacheRead)) * 100
      : 0;

  const top2Gap =
    top2 && top?.totalTokens
      ? Math.round(((top.totalTokens ?? 0) / (top2.totalTokens ?? 1)) * 10) / 10
      : null;

  return [
    {
      id: "top_model",
      title: "主力模型",
      body: `${topRatio}${topRatio !== "0" ? " 的 token 走了这一个模型" : ""}`,
      highlight: topModel,
      variant: "info",
    },
    {
      id: "cache_hit_rate",
      title: "缓存命中率",
      body: `输入+缓存写入+缓存命中 的总输入中，缓存命中占比 ${cacheHitRatio.toFixed(1)}%`,
      highlight: cacheHitRatio >= 50 ? `${cacheHitRatio.toFixed(1)}%` : "",
      variant:
        cacheHitRatio >= 50
          ? "positive"
          : cacheHitRatio < 20
            ? "negative"
            : "neutral",
    },
    {
      id: "input_output_ratio",
      title: "输入/输出比",
      body:
        totalOutput > 0
          ? `每生成 1 个 token 的输入 token 量`
          : "输入 token 总量大于输出",
      highlight:
        totalOutput > 0
          ? (totalInput / totalOutput).toFixed(2)
          : totalInput > 0
            ? "全输入"
            : "",
      variant:
        totalOutput > 0 && totalInput / totalOutput > 5 ? "negative" : "neutral",
    },
    {
      id: "top2_gap",
      ...(top2 && top2Gap
        ? {
            title: "Top1 vs Top2",
            body: `第一名是第二名的 ${top2Gap} 倍`,
            highlight: `${top2Gap}×`,
            variant: top2Gap > 10 ? "info" : "neutral",
          }
        : {
            title: "模型集中度",
            body: "目前只用了一个模型",
            highlight: "",
            variant: "neutral",
          }),
    },
  ];
}
