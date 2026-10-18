import { describe, expect, it } from "vitest";
import {
  authorShares,
  labelFromSlug,
  modelLeaderboard,
  splitWindows,
} from "@/components/usage/rankings";
import type { OpenRouterRankingRow } from "@/types/usage";

const row = (
  date: string,
  model: string,
  totalTokens: number,
): OpenRouterRankingRow => ({ date, model, totalTokens });

describe("splitWindows", () => {
  it("把 14 天切成两个 7 天窗口", () => {
    const rows = [
      row("2026-10-01", "a/b", 1),
      row("2026-10-07", "a/b", 2),
      row("2026-10-08", "a/b", 3),
      row("2026-10-14", "a/b", 4),
    ];
    const { current, previous } = splitWindows(rows, "week");
    expect(current.map((r) => r.date)).toEqual(["2026-10-08", "2026-10-14"]);
    expect(previous.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-07"]);
  });

  it("month 周期用 30 天窗口", () => {
    const rows = [
      row("2026-09-01", "a/b", 1),
      row("2026-09-15", "a/b", 5),
      row("2026-10-05", "a/b", 9),
    ];
    const { current, previous } = splitWindows(rows, "month");
    expect(current.map((r) => r.date)).toEqual(["2026-09-15", "2026-10-05"]);
    expect(previous.map((r) => r.date)).toEqual(["2026-09-01"]);
  });
});

describe("labelFromSlug", () => {
  it("author 取 permaslug 前缀，label 去掉前缀并保留变体后缀", () => {
    expect(labelFromSlug("openai/gpt-4o:free")).toBe("gpt-4o:free");
    expect(labelFromSlug("other")).toBe("other");
    const r = modelLeaderboard([row("2026-10-10", "openai/gpt-4o:free", 7)], "week");
    expect(r[0]).toMatchObject({
      model: "openai/gpt-4o:free",
      label: "gpt-4o:free",
      author: "openai",
    });
  });
});

describe("modelLeaderboard", () => {
  it("榜单不含 other 行", () => {
    const r = modelLeaderboard(
      [row("2026-10-10", "openai/gpt-4o", 100), row("2026-10-10", "other", 9999)],
      "week",
    );
    expect(r.map((x) => x.model)).toEqual(["openai/gpt-4o"]);
  });

  it("变体按独立条目排名", () => {
    const r = modelLeaderboard(
      [
        row("2026-10-10", "openai/gpt-4o", 100),
        row("2026-10-10", "openai/gpt-4o:free", 5),
      ],
      "week",
    );
    expect(r.map((x) => x.model)).toEqual(["openai/gpt-4o", "openai/gpt-4o:free"]);
  });

  it("环比 = (当前 - 前一) / 前一", () => {
    const r = modelLeaderboard(
      [row("2026-10-01", "a/b", 100), row("2026-10-08", "a/b", 300)],
      "week",
    );
    expect(r[0].tokens).toBe(300);
    expect(r[0].deltaPct).toBeCloseTo(200, 10); // 100 → 300 即 +200%
  });

  it("前一窗口为 0 时标为新增，deltaPct 为 null", () => {
    const r = modelLeaderboard(
      [row("2026-10-10", "a/b", 500), row("2026-10-11", "a/b", 500)],
      "week",
    );
    expect(r).toHaveLength(1);
    expect(r[0].isNew).toBe(true);
    expect(r[0].deltaPct).toBeNull();
  });

  it("超大数值不塌成 0 或 NaN", () => {
    const r = modelLeaderboard([row("2026-10-10", "a/b", 1.2e13)], "week");
    expect(Number.isFinite(r[0].tokens)).toBe(true);
    expect(r[0].tokens).toBeGreaterThan(1e12);
  });
});

describe("authorShares", () => {
  it("份额按作者聚合并折算成占比，other 计入分母", () => {
    const rows = [
      row("2026-10-10", "openai/gpt-4o", 100),
      row("2026-10-10", "openai/gpt-4o-mini", 100),
      row("2026-10-10", "anthropic/claude", 100),
      row("2026-10-10", "other", 100),
    ];
    const s = authorShares(rows, "week");
    // 同值时按作者名升序
    expect(s.map((x) => x.author)).toEqual(["openai", "anthropic", "other"]);
    expect(s.map((x) => x.tokens)).toEqual([200, 100, 100]);
    // 200 / 400（other 计入分母）
    expect(s[0].share).toBeCloseTo(0.5, 10);
    expect(s.reduce((acc, x) => acc + x.share, 0)).toBeCloseTo(1, 10);
  });
});

describe("空数据", () => {
  it("空数组返回空结果", () => {
    expect(splitWindows([], "week")).toEqual({ current: [], previous: [] });
    expect(modelLeaderboard([], "week")).toEqual([]);
    expect(authorShares([], "week")).toEqual([]);
  });
});
