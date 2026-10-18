export interface OpenRouterRankingRow {
  date: string;
  model: string;
  totalTokens: number;
}

export interface OpenRouterRankings {
  status: "ok" | "no_key" | "unauthorized" | "api_error";
  message?: string;
  asOf?: string;
  rows: OpenRouterRankingRow[];
}

export type RankingsPeriod = "week" | "month";
export const PERIOD_DAYS: Record<RankingsPeriod, number> = {
  week: 7,
  month: 30,
};

export interface LeaderboardRow {
  model: string;
  label: string;
  author: string;
  tokens: number;
  deltaPct: number | null;
  isNew: boolean;
}

export interface AuthorShare {
  author: string;
  tokens: number;
  share: number;
}

/** permaslug → 显示名（去掉作者前缀，保留 `:variant` 后缀）；无 `/` 时原样返回 */
export function labelFromSlug(slug: string): string {
  const slash = slug.lastIndexOf("/");
  return slash === -1 ? slug : slug.slice(slash + 1);
}

/** 以数据里的最大日期为基准切成「当前窗口 / 前一窗口」 */
export function splitWindows(
  rows: readonly OpenRouterRankingRow[],
  period: RankingsPeriod,
): { current: OpenRouterRankingRow[]; previous: OpenRouterRankingRow[] } {
  if (rows.length === 0) {
    return { current: [], previous: [] };
  }
  const maxDate = rows.reduce(
    (max, r) => (r.date > max ? r.date : max),
    rows[0].date,
  );
  const maxMs = Date.UTC(
    parseInt(maxDate.slice(0, 4)),
    parseInt(maxDate.slice(5, 7)) - 1,
    parseInt(maxDate.slice(8, 10)),
  );
  const currentStart = new Date(maxMs - PERIOD_DAYS[period] * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const previousStart = new Date(maxMs - PERIOD_DAYS[period] * 2 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  // 当前窗口：(currentStart, maxDate]；前一窗口：(previousStart, currentStart]
  const current = rows.filter(
    (r) => r.date > currentStart && r.date <= maxDate,
  );
  const previous = rows.filter(
    (r) => r.date > previousStart && r.date <= currentStart,
  );
  return { current, previous };
}

export function modelLeaderboard(
  rows: readonly OpenRouterRankingRow[],
  period: RankingsPeriod,
): LeaderboardRow[] {
  const { current, previous } = splitWindows(rows, period);
  const currentTokens = new Map<string, number>();
  for (const r of current) {
    if (r.model === "other") continue;
    currentTokens.set(
      r.model,
      (currentTokens.get(r.model) ?? 0) + r.totalTokens,
    );
  }
  const previousTokens = new Map<string, number>();
  for (const r of previous) {
    if (r.model === "other") continue;
    previousTokens.set(
      r.model,
      (previousTokens.get(r.model) ?? 0) + r.totalTokens,
    );
  }

  const result: LeaderboardRow[] = [];
  for (const [model, cur] of currentTokens) {
    const prev = previousTokens.get(model) ?? 0;
    const isNew = prev === 0 && cur > 0;
    const deltaPct =
      prev === 0 ? null : cur === 0 ? -100 : ((cur - prev) / prev) * 100;
    result.push({
      model,
      label: labelFromSlug(model),
      author: model.split("/")[0],
      tokens: cur,
      deltaPct,
      isNew,
    });
  }
  result.sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));
  return result;
}

/** 当前窗口按作者聚合份额；降序；含 "other"（作者记作 "other"） */
export function authorShares(
  rows: readonly OpenRouterRankingRow[],
  period: RankingsPeriod,
): AuthorShare[] {
  const { current } = splitWindows(rows, period);
  const authorTokens = new Map<string, number>();
  for (const r of current) {
    const author = r.model.includes("/") ? r.model.split("/")[0] : r.model;
    authorTokens.set(author, (authorTokens.get(author) ?? 0) + r.totalTokens);
  }
  const total = Array.from(authorTokens.values()).reduce((a, b) => a + b, 0);
  const result: AuthorShare[] = [];
  for (const [author, tokens] of authorTokens) {
    result.push({ author, tokens, share: total > 0 ? tokens / total : 0 });
  }
  result.sort(
    (a, b) => b.tokens - a.tokens || a.author.localeCompare(b.author),
  );
  return result;
}
