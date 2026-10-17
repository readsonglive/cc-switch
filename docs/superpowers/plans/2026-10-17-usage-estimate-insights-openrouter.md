# 用量页扩展（估算价格 / 个人洞察 / 全网榜）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有「用量统计」页内新增三块内容——用真实 token 计较的「估算价格」、4 格「个人使用量洞察」、实时拉取 OpenRouter 公开数据的第 5 个 Tab「全网榜」，并给共用翻页条加上首页/尾页。

**Architecture:** 纯计算全部抽成无副作用的 TS 模块（`estimateCost.ts` / `insights.ts` / `rankings.ts`），用 vitest 直接测；组件只做取数与渲染。OpenRouter 那边 Rust 只负责「取数 + 校验 + 原样透出」（`services/openrouter_rankings.rs`），聚合放在前端纯函数里。估算价格复用 `UsageHero` 已有的 `useUsageSummaryByApp` 缓存条目，不发重复请求。

**Tech Stack:** React + TypeScript（Vite）、TanStack Query、i18next、Tauri 2 + Rust（reqwest、serde）、vitest + MSW、Tailwind。

**Spec:** `docs/superpowers/specs/2026-10-17-usage-estimate-insights-openrouter-design.md`

## 范围与非目标

本轮做（13 个任务全部落在一个页面里）：

- 用量页：估算价格面板、4 格个人洞察、翻页条首页/尾页。
- 新的第 5 个 Tab「全网榜」：OpenRouter 的**模型调用量榜** + **厂商 token 份额**（周 / 月）。
- 支撑上面两块所需的取数通路（Rust 命令 + 前端 query）与设置项。

本轮**不做**（spec 里的 v2，别顺手加）：

- OpenRouter 的**应用榜 / 智能体榜**（`/api/v1/datasets/app-rankings`）。
- 令牌级的真实计费对账：估算价格是「本地 token 口径 × 定价表单价」的估算，**不是账单**。
- 精度改造：`total_tokens` 用 Number 处理（显示只到 3 位有效数字）；要精确到个位需改 BigInt，本轮不做。
- 清理历史欠账：`tr` 缺的 20 个 `usage.display.*` / `usage.logColumns.*` 译文不在本轮补。

## Global Constraints

- 工作目录一律 `D:\000Lxs\gitPjoj\cc-switch`（fork，分支 `merge-orca-custom`）。
- 注释、文档、commit subject 用中文；commit 走 Conventional Commits（type 英文 + 中文描述）。
- i18n 五份必须同步补齐：`zh` / `zh-TW` / `en` / `ja` / `tr`（`src/i18n/locales/*.json`）。漏译文不会让构建失败，只会静默回退英文或显示 key。
- locale 文件里是**嵌套对象**（`{"usage": {"noData": "...", "pricing": {...}}}`），不是扁平的 `"usage.noData"` 键。新增 `usage.estimate.*` / `usage.insights.*` / `usage.global.*` / `usage.openrouterKey.*` 就是往 `usage` 对象里加对应名字的子对象。
- Tauri 命令：Rust 侧函数名 `snake_case`，前端 `invoke` 传参写 `camelCase`；新命令必须在 `src-tauri/src/lib.rs` 的 `generate_handler!` 里注册。
- 金额一律以美元存储/计算，显示走 `useMoneyFormat()`（`money` / `moneyTitle`）。
- **不新增任何 npm / cargo 依赖**：多选用现有 `popover` + `command` + `checkbox`（参考 `ModelsDevPickerDialog.tsx` 的既有做法）。
- 前端只有 Prettier（只管 `src/`）+ `tsc`，没有 ESLint。提交前跑 `pnpm format`。
- vitest 单文件冷启动约 1–2 分钟（setup 占大头），不是卡死。
- **测试里的 i18n 资源是空的**（`tests/setupTests.ts` 只注册了空的 `zh` / `en`），`t("usage.xxx")` 会原样返回 key。所以组件测试断言的是 **i18n key 字符串**（如 `screen.getByText("usage.noData")`），不是中文文案——这是本仓库既有测试的通用写法。语言用 `lng: "zh"`，但资源为空，靠 key 断言照样能跑。
- 参考稿（只读，不要改动/提交）：`docs/llm_cost_panel.html`、`docs/全网Token看板.html`、`docs/Token用量排行榜-OpenRouter公开数据.pdf`。

## Review Focus

以下五类是 spec 隐含、但最容易在真实数据上出问题的地方。每条都要在拥有该代码的任务里落一条测试：

1. **定价表模型名与用量库的「有效计价模型」对不上**（用量库按 `pricing_model` 优先分组）→ 估算价格的默认勾选可能匹配不到，面板一开始就是空的。合理预期：匹配不上时回落到定价表前 5 个，而不是空白。
2. **缓存单价缺失**（models.dev 里很常见）→ 缓存 token 按 0 计会把「无缓存模型」的估算算得更低。合理预期：该行明确标注未配缓存单价。
3. **OpenRouter 数据里的 `other` 行与 `:free` 变体**（permaslug 形如 `openai/gpt-4o:free`）→ 合理预期：`other` 不进榜单/份额；变体与官网一致，按独立条目排名，且作者取 `/` 前的前缀。
4. **无 Key / Key 失效 / 网络中断** → 合理预期：`no_key` 给引导而不是报错；`unauthorized` 明确说 Key 无效；瞬时网络错误保留上一次成功数据并标注，不白屏、也不静默假装是新数据。
5. **超大数值**（日榜单行可达 1e13，两窗口累计接近 1e15）→ 合理预期：Number 聚合不掉到明显错的量级，`formatTokensCompact` 显示成 `174.2T` / `174.2万亿` 这类 3 位有效数字。

---

## Tasks

任务按依赖顺序排列，**从上往下依次执行**：每个任务自己写测试、跑测试、单独提交一次。Task 1 与 Task 7 各自独立，可以随时先做；Task 9 必须在 Task 11 之前落地（Task 11 用它的类型与纯函数）。

---

### Task 1: 翻页条加首页 / 尾页

**Files:**
- Modify: `src/components/usage/TablePagination.tsx:1-92`
- Modify: `src/i18n/locales/{zh,zh-TW,en,ja,tr}.json`
- Test: `tests/components/TablePagination.test.tsx`

**Interfaces:**
- Consumes: 无。
- Produces: 组件对外 props 不变（`page` / `totalPages` / `total` / `onPageChange`）——只是渲染更多按钮，调用方无需改动。

- [ ] **Step 1: 写失败测试**

```tsx
// tests/components/TablePagination.test.tsx
// 注意：测试环境的 i18n 资源是空的（tests/setupTests.ts 里 resources 只有空对象），
// t("usage.firstPage") 会原样返回 key，所以断言的是 **i18n key**，不是中文。
// 这也正是本仓库既有测试的写法（如 ProviderStatsTable.test.tsx 里的 "usage.noData"）。

it("单页时不显示首页/尾页按钮", () => {
  render(<TablePagination page={0} totalPages={1} total={3} onPageChange={() => {}} />);
  expect(screen.queryByLabelText("usage.firstPage")).toBeNull();
  expect(screen.queryByLabelText("usage.lastPage")).toBeNull();
});

it("多页时首页跳到第 1 页、尾页跳到最后一页", async () => {
  const onPageChange = vi.fn();
  render(<TablePagination page={1} totalPages={5} total={90} onPageChange={onPageChange} />);
  await userEvent.click(screen.getByLabelText("usage.firstPage"));
  expect(onPageChange).toHaveBeenCalledWith(0);
  onPageChange.mockClear();
  await userEvent.click(screen.getByLabelText("usage.lastPage"));
  expect(onPageChange).toHaveBeenCalledWith(4);
});

it("已在首/尾页时对应按钮禁用", () => {
  const { rerender } = render(<TablePagination page={0} totalPages={3} total={50} onPageChange={() => {}} />);
  expect(screen.getByLabelText("usage.firstPage")).toBeDisabled();
  rerender(<TablePagination page={2} totalPages={3} total={50} onPageChange={() => {}} />);
  expect(screen.getByLabelText("usage.lastPage")).toBeDisabled();
});
```

用项目已有的测试语汇（`@testing-library/react` + `@testing-library/user-event`，参考 `tests/components/` 下现有用法）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/components/TablePagination.test.tsx`
Expected: FAIL —— 找不到 aria-label 为 `usage.firstPage` / `usage.lastPage` 的按钮。

- [ ] **Step 3: 实现**

`src/components/usage/TablePagination.tsx`：

- 从 `lucide-react` 追加引入 `ChevronsLeft`、`ChevronsRight`。
- 在「上一页」左侧插入首页按钮、在「下一页」右侧插入尾页按钮，复用同一个 `NAV_BUTTON` 类：

```tsx
{totalPages > 1 && (
  <HoverTip content={t("usage.firstPage")}>
    <button
      type="button"
      className={NAV_BUTTON}
      aria-label={t("usage.firstPage")}
      disabled={page === 0}
      onClick={() => onPageChange(0)}
    >
      <ChevronsLeft className="h-4 w-4" />
    </button>
  </HoverTip>
)}
```

尾页对称：`aria-label={t("usage.lastPage")}`、`disabled={page >= totalPages - 1}`、`onClick={() => onPageChange(totalPages - 1)}`、图标 `ChevronsRight`。**「上一页 / 下一页」也一并放进 `totalPages > 1` 判断里**，保证「多页时才显示导航」。

- [ ] **Step 4: 补五个语言的文案**

在五个 locale 的 `usage` 段里加（key 与其它语言保持一致，只改 value）。

**JSON 结构**：locale 文件里 `usage` 是一个**嵌套对象**（`{"usage": {"noData": "暂无数据", "pricing": {...}}}`），不是扁平的 `"usage.noData"` 键。所以这两个键直接加在 `usage` 对象下（和 `usage.noData` 同级），代码里用 `t("usage.firstPage")` 取：

| key | zh | zh-TW | en | ja | tr |
| --- | --- | --- | --- | --- | --- |
| `usage.firstPage` | 首页 | 首頁 | First page | 最初のページ | İlk sayfa |
| `usage.lastPage` | 尾页 | 末頁 | Last page | 最後のページ | Son sayfa |

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/components/TablePagination.test.tsx && pnpm typecheck`
Expected: PASS、typecheck exit 0。

- [ ] **Step 6: 提交**

```bash
git add src/components/usage/TablePagination.tsx src/i18n/locales tests/components/TablePagination.test.tsx
git commit -m "feat(usage): 翻页条加首页/尾页按钮（仅多页时显示）"
```

---

### Task 2: 估算价格计算核心

**Files:**
- Create: `src/components/usage/estimateCost.ts`
- Test: `tests/components/estimateCost.test.ts`

**Interfaces:**
- Consumes: `ModelPricing`（`src/types/usage.ts`，字段 `modelId` / `displayName` / `inputCostPerMillion` / `outputCostPerMillion` / `cacheReadCostPerMillion` / `cacheCreationCostPerMillion`，全部是**字符串**，单位「每百万 token 的美元」）；`parseFiniteNumber`（`./format`）。
- Produces:
  ```ts
  export interface TokenBreakdown { input: number; output: number; cacheWrite: number; cacheRead: number }
  export interface PriceEstimate { modelId: string; displayName: string; costUsd: number; hasCachePricing: boolean }
  export function estimateModelCost(tokens: TokenBreakdown, pricing: ModelPricing): PriceEstimate
  export function estimateAll(tokens: TokenBreakdown, pricings: readonly ModelPricing[]): PriceEstimate[]
  ```

- [ ] **Step 1: 写失败测试**

```ts
// tests/components/estimateCost.test.ts
import { describe, expect, it } from "vitest";
import { estimateAll, estimateModelCost } from "@/components/usage/estimateCost";
import type { ModelPricing } from "@/types/usage";

const pricing = (over: Partial<ModelPricing> = {}): ModelPricing => ({
  modelId: "m1", displayName: "M1",
  inputCostPerMillion: "1", outputCostPerMillion: "2",
  cacheReadCostPerMillion: "0.1", cacheCreationCostPerMillion: "1.5",
  ...over,
});

describe("estimateModelCost", () => {
  it("按四项单价分别乘除以百万", () => {
    const r = estimateModelCost({ input: 1_000_000, output: 500_000, cacheWrite: 200_000, cacheRead: 3_000_000 }, pricing());
    // 1*1 + 0.5*2 + 0.2*1.5 + 3*0.1 = 1 + 1 + 0.3 + 0.3 = 2.6
    expect(r.costUsd).toBeCloseTo(2.6, 10);
    expect(r.hasCachePricing).toBe(true);
  });

  it("缓存单价缺失时按 0 计并标记", () => {
    const r = estimateModelCost({ input: 1_000_000, output: 0, cacheWrite: 5_000_000, cacheRead: 5_000_000 },
      pricing({ cacheReadCostPerMillion: "", cacheCreationCostPerMillion: "" }));
    expect(r.costUsd).toBeCloseTo(1, 10);
    expect(r.hasCachePricing).toBe(false);
  });

  it("单价是坏值时按 0，不产生 NaN", () => {
    const r = estimateModelCost({ input: 1_000_000, output: 1_000_000, cacheWrite: 0, cacheRead: 0 },
      pricing({ inputCostPerMillion: "abc", outputCostPerMillion: "-2" }));
    expect(r.costUsd).toBe(0);
    expect(Number.isNaN(r.costUsd)).toBe(false);
  });
});

describe("estimateAll", () => {
  it("按估算价升序", () => {
    const rows = estimateAll({ input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 }, [
      pricing({ modelId: "b", displayName: "B", inputCostPerMillion: "3" }),
      pricing({ modelId: "a", displayName: "A", inputCostPerMillion: "1" }),
    ]);
    expect(rows.map((r) => r.modelId)).toEqual(["a", "b"]);
  });

  it("空定价表返回空数组", () => {
    expect(estimateAll({ input: 1, output: 1, cacheWrite: 1, cacheRead: 1 }, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/components/estimateCost.test.ts`
Expected: FAIL —— `Cannot find module '@/components/usage/estimateCost'`。

- [ ] **Step 3: 实现 `estimateCost.ts`**

`perMillion(raw, tokens) = (parseFiniteNumber(raw) ?? 0) * tokens / 1e6`，取负值按 0（`Math.max(0, ...)`）；`hasCachePricing` = 缓存两项单价都能解析出非 0 的值。`estimateAll` 用 `[...pricings].map(...).sort((a, b) => a.costUsd - b.costUsd || a.displayName.localeCompare(b.displayName))`。中文注释说明「缓存按 0 计」这条约定。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/components/estimateCost.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/components/usage/estimateCost.ts tests/components/estimateCost.test.ts
git commit -m "feat(usage): 估算价格计算核心（四口径 + 缓存缺失按 0）"
```

---

### Task 3: 抽出 `usageSummary.ts` 供复用

**Files:**
- Create: `src/components/usage/usageSummary.ts`
- Modify: `src/components/usage/UsageHero.tsx`
- Test: `tests/components/UsageHero.test.tsx`（既有，必须保持全绿）、`tests/components/usageSummary.test.ts`（新增，覆盖抽取出来的纯函数）

**Interfaces:**
- Consumes: `UsageSummaryByApp`、`UsageSummary`（`@/types/usage`）。
- Produces: 从 `UsageHero.tsx` **原样搬出**的两个函数（名字、签名、算法都不许改）：
  ```ts
  export function aggregateSummaries(items: UsageSummary[]): UsageSummary
  export function pickSummary(apps: UsageSummaryByApp[], appType: string | undefined): UsageSummary | undefined
  ```
  两个都已在 `UsageHero.tsx` 里（`aggregateSummaries` 现为 `export function`，位于第 42 行；`pickSummary` 是私有函数，位于第 75 行）。全仓库没有其它地方引用 `aggregateSummaries`，可以安全搬走。

- [ ] **Step 1: 先给搬出来的函数补测试（把当前行为钉死）**

```ts
// tests/components/usageSummary.test.ts
import { describe, expect, it } from "vitest";
import { aggregateSummaries, pickSummary } from "@/components/usage/usageSummary";
import type { UsageSummary, UsageSummaryByApp } from "@/types/usage";

const A: UsageSummary = { totalRequests: 10, totalCost: "1.5", totalInputTokens: 100, totalOutputTokens: 50, totalCacheCreationTokens: 20, totalCacheReadTokens: 30, successRate: 90, realTotalTokens: 200, cacheHitRate: 0.2 };
const B: UsageSummary = { totalRequests: 30, totalCost: "2.5", totalInputTokens: 300, totalOutputTokens: 100, totalCacheCreationTokens: 0, totalCacheReadTokens: 200, successRate: 100, realTotalTokens: 600, cacheHitRate: 0.4 };
const apps: UsageSummaryByApp[] = [{ appType: "claude", summary: A }, { appType: "codex", summary: B }];

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
  expect(r.successRate).toBeCloseTo(97.5, 10);        // (10*0.9 + 30*1.0) / 40 * 100
  expect(r.cacheHitRate).toBeCloseTo(230 / 650, 10);  // 230 / (400 + 20 + 230)
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
```

上面的期望值可由第 42–84 行的现有实现逐条验算：`successRate` 是 `round(totalRequests * successRate) / totalRequests * 100`，`cacheHitRate` 是 `cacheRead / (input + cacheCreation + cacheRead)`，`totalCost` 走 `toFixed(6)`。**先按现有实现核对一遍再落测试；若数字对不上，说明我算错了，以实现为准并在 commit message 里说明**。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/components/usageSummary.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 搬运**

把 `UsageHero.tsx` 第 42–84 行的 `aggregateSummaries` 与 `pickSummary` 两个函数**逐字**剪切到新文件并 `export`；在 `UsageHero.tsx` 里改成 `import { pickSummary } from "./usageSummary";`（`UsageHero` 自己不用 `aggregateSummaries`，不必导入它）。不改任何算法、不改命名、不改注释——这一步是纯搬运，`git diff` 里应只有「删除 + import」。

- [ ] **Step 4: 跑相关测试确认行为未变**

Run: `npx vitest run tests/components/usageSummary.test.ts tests/components/UsageHero.test.tsx && pnpm typecheck`
Expected: 全绿（`UsageHero` 既有用例一个都不能掉）。

- [ ] **Step 5: 提交**

```bash
git add src/components/usage/usageSummary.ts src/components/usage/UsageHero.tsx tests/components/usageSummary.test.ts
git commit -m "refactor(usage): 抽出 pickSummary 供估算价格复用"
```

---

### Task 4: 估算价格面板 + 挂载

**Files:**
- Create: `src/components/usage/PriceEstimatePanel.tsx`
- Modify: `src/components/usage/UsageDashboard.tsx`（在 `<UsageHero>` 之后挂载）
- Modify: `src/i18n/locales/*.json`（5 份）
- Test: `tests/components/PriceEstimatePanel.test.tsx`

**Interfaces:**
- Consumes: `estimateAll`、`TokenBreakdown`（Task 2）；`pickSummary`（Task 3）；`useModelPricing`、`useModelStats`、`useUsageSummaryByApp`（`@/lib/query/usage`）；`useMoneyFormat`；`formatTokensCompact`、`parseFiniteNumber`（`./format`）。
- Produces:
  ```ts
  interface PriceEstimatePanelProps {
    range: UsageRangeSelection;
    appType?: string;
    providerName?: string;
    model?: string;
    compact?: boolean;
  }
  export function PriceEstimatePanel(props: PriceEstimatePanelProps): JSX.Element
  ```

- [ ] **Step 1: 写失败测试**

```tsx
// tests/components/PriceEstimatePanel.test.tsx
// 用 vi.mock 掉 @/lib/query/usage 的三个 hook，每个用例直接给定返回值
// （参考 UsageDashboard.test.tsx 里 mock useProviderStats / useModelStats 的写法）

const range = { preset: "all" as const };

/** useModelPricing 的一张定价条目；单价单位是「每百万 token 的美元」，值是字符串 */
const pricing = (over: Partial<ModelPricing> = {}): ModelPricing => ({
  modelId: "m", displayName: "M",
  inputCostPerMillion: "1", outputCostPerMillion: "0",
  cacheReadCostPerMillion: "0", cacheCreationCostPerMillion: "0",
  ...over,
});

/** useUsageSummaryByApp 的行；用量口径：input / output / cacheCreation / cacheRead */
const summaryRows = (s: Partial<UsageSummary>) => [{ appType: "claude", summary: { totalRequests: 0, totalCost: "0", totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0, successRate: 0, realTotalTokens: 0, cacheHitRate: 0, ...s } }];

it("按当前筛选的 token × 定价表算出估算价，并按升序排列", () => {
  // 用量：输入 1,000,000 token；定价表：cheap(1$/M) 与 pricey(3$/M)
  // 断言：cheap 与 pricey 两个名字都渲染出来，且 cheap 的行在 pricey 之前
});

it("默认勾选当前用量最高的模型对应的定价条目", () => {
  // useModelStats 给 [{ model: "gpt-4o", requestCount: 10 }, { model: "other", requestCount: 1 }]
  // 定价表含 modelId "gpt-4o" 与 "other-model"
  // 断言：gpt-4o 的复选框是选中的，other-model 不是
});

it("定价表里一个都没匹配上时回落到定价表前 5 个，而不是空白", () => {   // Review Focus #1
  // useModelStats 给 [{ model: "不存在的模型", requestCount: 99 }]，定价表给 6 条互不相同的条目
  // 断言：仍然渲染出 5 行，且没有出现空状态文案
});

it("模型没配缓存单价时该行标注未配缓存单价", () => {                     // Review Focus #2
  // 用量：cacheWrite 与 cacheRead 都很大；定价：缓存两项单价为空字符串
  // 断言：该行出现「未配置缓存单价，缓存 token 按 0 计」的提示
});

it("定价表为空时显示去配置定价的空状态", () => {
  // useModelPricing 给 []
  // 断言：空状态文案出现，且没有表格
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/components/PriceEstimatePanel.test.tsx`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现组件**

自上而下：

1. 标题行：`t("usage.estimate.title")` + `HelpTip`。
2. 多选框：`popover` + `command` + `checkbox` 列表，条目 = `useModelPricing()` 的 `displayName`（值用 `modelId`）；带搜索框；内部 state `selectedIds: string[]`（用 `useState`，不落 localStorage）。
3. 结果区：摘要行 + 表格（`模型 / 估算总价 / 相对成本条`）。
   - token：`pickSummary(useUsageSummaryByApp(range, { providerName, model }, { refetchInterval: false }).data ?? [], appType)` → `{ input: totalInputTokens, output: totalOutputTokens, cacheWrite: totalCacheCreationTokens, cacheRead: totalCacheReadTokens }`。
   - 金额显示 `money(costUsd, 4)`，`title={moneyTitle(costUsd, 6)}`。
   - 成本条宽度 = `costUsd / maxCostUsd * 100%`。
   - 摘要：`最省：<displayName> <金额> · 省 N%`，N 相对当前勾选里的最高价。
4. 默认勾选逻辑：`useModelStats` 结果按 `requestCount` 降序取前 5 个模型名 → 与定价表 `modelId`/`displayName` 求交 → 若交集为空则取定价表前 5 个。**用 `useState` 只在首次有数据时初始化一次**（不要每次渲染都覆盖用户的选择）。

`UsageDashboard.tsx`：在 `<UsageHero ... />` 之后插入 `<PriceEstimatePanel range={range} appType={scopedAppType} providerName={providerName} model={model} compact={compact} />`。

- [ ] **Step 4: 补五个语言的文案**

`usage.estimate.*`：`title`(估算价格) / `pickModels`(选择大模型) / `cheapest`(最省) / `saves`(省 {percent}%) / `model`(模型) / `cost`(估算总价) / `noCachePrice`(该模型未配置缓存单价，缓存 token 按 0 计) / `pickHint`(先选择要对比的模型) / `emptyPricing`(先在「设置」里配置模型定价)。五语言按上表格式补齐。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/components/PriceEstimatePanel.test.tsx tests/components/UsageDashboard.test.tsx && pnpm typecheck`
Expected: PASS、typecheck exit 0。

- [ ] **Step 6: 提交**

```bash
git add src/components/usage/PriceEstimatePanel.tsx src/components/usage/UsageDashboard.tsx src/i18n/locales tests/components/PriceEstimatePanel.test.tsx
git commit -m "feat(usage): 指标区下方加「估算价格」（大模型多选 + 比价）"
```

---

### Task 5: 洞察计算核心

**Files:**
- Create: `src/components/usage/insights.ts`
- Test: `tests/components/insights.test.ts`

**Interfaces:**
- Consumes: `ModelStats`、`ProviderStats`、`DailyStats`（`@/types/usage`）；`parseFiniteNumber`（`./format`）。
- Produces:
  ```ts
  export interface RankedCost { name: string; costUsd: number }
  /** 0–1；没有任何模型数据时 null */
  export function freeTokenShare(models: readonly ModelStats[]): number | null
  export function priciestModel(models: readonly ModelStats[]): RankedCost | null
  export function priciestProvider(providers: readonly ProviderStats[]): RankedCost | null
  export interface WeekOverWeek { currentTokens: number; previousTokens: number; deltaPct: number | null; isNew: boolean }
  /** 以数据里的最大日期为基准切「近 7 日 / 前 7 日」；两份都为空时 null */
  export function weekOverWeek(trends: readonly DailyStats[]): WeekOverWeek | null
  ```

- [ ] **Step 1: 写失败测试**

```ts
// tests/components/insights.test.ts
import { describe, expect, it } from "vitest";
import { freeTokenShare, priciestModel, priciestProvider, weekOverWeek } from "@/components/usage/insights";
import type { DailyStats } from "@/types/usage";

describe("freeTokenShare", () => {
  it("只把 totalCost 为 0 的模型算作零费用", () => {
    expect(freeTokenShare([
      { model: "a", totalTokens: 300, totalCost: "0", requestCount: 1, avgCostPerRequest: "0", successRate: 1 },
      { model: "b", totalTokens: 100, totalCost: "2", requestCount: 1, avgCostPerRequest: "2", successRate: 1 },
    ])).toBeCloseTo(0.75, 10);
  });
  it("没有数据时返回 null", () => { expect(freeTokenShare([])).toBeNull(); });
});

describe("priciestModel / priciestProvider", () => {
  it("取 totalCost 最大的那一行", () => {
    expect(priciestModel([
      { model: "cheap", totalTokens: 1, totalCost: "0.5", requestCount: 1, avgCostPerRequest: "0.5", successRate: 1 },
      { model: "pricey", totalTokens: 1, totalCost: "3.5", requestCount: 1, avgCostPerRequest: "3.5", successRate: 1 },
    ])).toEqual({ name: "pricey", costUsd: 3.5 });
  });
  it("空表 / 全为 0 时返回 null", () => {
    expect(priciestModel([])).toBeNull();
    expect(priciestProvider([{ providerId: "p", appType: "claude", providerName: "P", requestCount: 1, totalTokens: 1, totalCost: "0", successRate: 1, avgLatencyMs: 0 }])).toBeNull();
  });
});

describe("weekOverWeek", () => {
  const day = (date: string, totalTokens: number): DailyStats => ({ date, requestCount: 1, totalCost: "0", totalTokens, totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0 });
  it("按最大日期切两窗口并算环比", () => {
    const rows = [...Array(14).keys()].map((i) => day(`2026-10-${String(i + 1).padStart(2, "0")}`, i < 7 ? 100 : 200));
    const r = weekOverWeek(rows)!;
    expect(r.currentTokens).toBe(1400);
    expect(r.previousTokens).toBe(700);
    expect(r.deltaPct).toBeCloseTo(100, 10);
  });
  it("前窗口为 0 且当前有量时标成新增", () => {
    const r = weekOverWeek([day("2026-10-10", 500)])!;
    expect(r.isNew).toBe(true);
    expect(r.deltaPct).toBeNull();
  });
  it("两边都为空时返回 null", () => { expect(weekOverWeek([])).toBeNull(); });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/components/insights.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `insights.ts`**

- 窗口切分用**日期字符串**（`YYYY-MM-DD` 可直接比大小），基准 = 数据里的最大 date；`current` = `(max - 7d, max]`，`previous` = `(max - 14d, max - 7d]`；用 `Date.UTC` 做 7 天偏移，避免本地时区漂移。
- `priciestModel` / `priciestProvider`：取 `totalCost` 解析后最大的那行，返回 `{ name, costUsd }`；全为 0 或空表时返回 null。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/components/insights.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/usage/insights.ts tests/components/insights.test.ts
git commit -m "feat(usage): 个人洞察计算核心（零费用占比 / 最贵 / 环比）"
```

---

### Task 6: 洞察带组件 + 挂载

**Files:**
- Create: `src/components/usage/UsageInsights.tsx`
- Modify: `src/components/usage/UsageDashboard.tsx`（在 `<PriceEstimatePanel>` 之后挂载）
- Modify: `src/i18n/locales/*.json`
- Test: `tests/components/UsageInsights.test.tsx`

**Interfaces:**
- Consumes: `freeTokenShare` / `priciestModel` / `priciestProvider` / `weekOverWeek`（Task 5）；`useModelStats` / `useProviderStats` / `useUsageTrends`；`useMoneyFormat`。
- Produces:
  ```ts
  interface UsageInsightsProps { appType?: string; providerName?: string; model?: string; compact?: boolean }
  export function UsageInsights(props: UsageInsightsProps): JSX.Element
  ```

- [ ] **Step 1: 写失败测试**

```tsx
// tests/components/UsageInsights.test.tsx —— 用 vi.mock 掉 @/lib/query/usage 的三个 hook
it("渲染四项洞察的标题", () => {
  // 断言四格标题（零费用 token 占比 / 最贵模型 / 最贵供应商 / 近 7 日 vs 前 7 日）都在
});
it("环比为正时带 + 号、为负时带 - 号", () => {
  // trends 给两窗数据造出 +100% 与 -50% 两种情况，分别断言 "+" / "-" 出现
});
it("环比数据不足时显示 — 而不是崩", () => {
  // trends 给 []，且 useUsageTrends 返回 { data: undefined, isLoading: false }
  // 断言该格显示 "—"，并且另外三格照常渲染
});
it("没有模型数据时零费用占比显示 —", () => {
  // useModelStats 给 []
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/components/UsageInsights.test.tsx`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现组件**

- 布局：`grid gap-2.5`，`compact ? "grid-cols-2" : "grid-cols-4"`，格子样式复用 `MiniMetric` 的观感（可以就地写一份同类结构，或把 `MiniMetric` 从 `UsageHero.tsx` 导出复用——优先后者，别再抄一份）。
- 数据：
  - `useModelStats(range, { appType, providerName, model })` → 前两格。
  - `useProviderStats(range, { appType, providerName, model })` → 第三格。
  - 第四格：**独立于页面时间范围**，用 `useUsageTrends({ preset: "14d" }, { appType, providerName, model })`，把结果交给 `weekOverWeek`。项目已有 `"14d"` 预设，不要手搓 custom 日期。拿不到数据（`data` 为空）时这一格显示 `—`，并且**不能影响另外三格**。
- 三个 hook 的 `refetchInterval` 传 `false`（面板自身不需要单独轮询，页面统一刷新已经会失效重取）。

- [ ] **Step 4: 补五个语言文案**

`usage.insights.*`：`freeShare`(零费用 token 占比) / `freeShareHelp`(费用为 0 的模型 token 占比；既包含真免费，也包含没配定价的模型) / `priciestModel`(最贵模型) / `priciestProvider`(最贵供应商) / `weekOverWeek`(近 7 日 vs 前 7 日) / `newModel`(新增) / `noData`(—)。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/components/UsageInsights.test.tsx tests/components/UsageDashboard.test.tsx && pnpm typecheck`
Expected: PASS、typecheck exit 0。

- [ ] **Step 6: 提交**

```bash
git add src/components/usage/UsageInsights.tsx src/components/usage/UsageDashboard.tsx src/i18n/locales tests/components/UsageInsights.test.tsx
git commit -m "feat(usage): 指标区下方加 4 格个人洞察"
```

---

### Task 7: OpenRouter 取数服务（Rust）

**Files:**
- Create: `src-tauri/src/services/openrouter_rankings.rs`
- Modify: `src-tauri/src/services/mod.rs`（加 `mod openrouter_rankings;` + `pub use openrouter_rankings::*;`，与 `mod balance; pub use balance::*;` 同风格）

**Interfaces:**
- Consumes: `crate::proxy::http_client::get()`（共享 reqwest client）；`serde_json`、`serde::Serialize`。
- Produces:
  ```rust
  #[derive(Debug, Clone, Serialize, PartialEq)]
  pub struct RankingRow { pub date: String, pub model: String, pub total_tokens: u64 }

  #[derive(Debug, Clone, Serialize, PartialEq)]
  pub struct RankingsResponse {
      pub status: String,          // "ok" | "no_key" | "unauthorized" | "api_error"
      pub message: Option<String>,
      pub as_of: Option<String>,
      pub rows: Vec<RankingRow>,
  }

  /// 纯解析：喂 body，出结构。未知/缺字段按 api_error 处理。
  pub fn parse_rankings(body: &serde_json::Value) -> RankingsResponse

  /// 取数：瞬时失败 Err，确定性失败 Ok(status != "ok")。
  pub async fn fetch_model_rankings(api_key: &str, period: &str) -> Result<RankingsResponse, String>
  ```

  与 spec 的 `RankingsResponse` 相比，这里**故意不带 `start_date` / `end_date`**：前端按数据里的最大日期自己切窗口，这两个字段没有任何消费方。不要为了「跟 spec 对齐」加回去。

- [ ] **Step 1: 写失败测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rows_and_meta() { /* 样例 JSON → status "ok"、as_of 取自 meta.as_of、rows 长度与 total_tokens 数值正确 */ }

    #[test]
    fn total_tokens_comes_from_decimal_string() { /* "1234567890" → 1234567890u64 */ }

    #[test]
    fn keeps_other_row_and_variants_verbatim() { /* model 原样保留 "other" 与 "openai/gpt-4o:free" */ }

    #[test]
    fn missing_data_field_is_api_error() { /* {} → status "api_error"，message 非空，rows 空 */ }

    #[test]
    fn bad_token_string_is_api_error() { /* total_tokens: "abc" → api_error，不 panic */ }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test openrouter_rankings`
Expected: FAIL —— 模块不存在（编译错误）。

- [ ] **Step 3: 实现服务**

要点（照抄 `services/balance.rs` 的既有姿势）：

1. URL：`https://openrouter.ai/api/v1/datasets/rankings-daily`，query `period`（只接受 `week` / `month`，其它值回落到 `week`）。
2. 头：`Authorization: Bearer {api_key}`、`Accept: application/json`，`.timeout(Duration::from_secs(15))`。
3. `client.get(...).send()` 的 `Err` → `Err(format!("Network error: {e}"))`（**瞬时**）。
4. 401 / 403 → `Ok(RankingsResponse { status: "unauthorized", .. })`；其它非 2xx → `Ok(status: "api_error")` + 状态码与响应体片段。
5. **先 `resp.bytes()` 再 `serde_json::from_slice`**：读体失败 → `Err`（瞬时）；解析失败 → `Ok(api_error)`（确定性）。文件顶部用注释写明这套「瞬时 / 确定性」两分法，并指回 `services/balance.rs`。
6. `parse_rankings`：`data` 数组里每行取 `date`(String)、`model_permaslug`(String)、`total_tokens`(String → `u64`，解析失败即整响应 `api_error`，不 panic)；`meta.as_of` 原样带出。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src-tauri && cargo test openrouter_rankings`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/services/openrouter_rankings.rs src-tauri/src/services/mod.rs
git commit -m "feat(openrouter): 全网榜取数服务（沿用 balance 的瞬时/确定性错误语义）"
```

---

### Task 8: OpenRouter 命令 + Key 解析

**Files:**
- Create: `src-tauri/src/commands/openrouter.rs`
- Modify: `src-tauri/src/commands/mod.rs`（加 `pub mod openrouter;`）
- Modify: `src-tauri/src/lib.rs`（`generate_handler!` 里加 `commands::get_openrouter_rankings`）
- Modify: `src-tauri/src/commands/provider.rs:551`（把 `fn resolve_native_credentials` 改成 `pub(crate) fn resolve_native_credentials`）
- Modify: `src-tauri/src/settings.rs`（`AppSettings` 加 `openrouter_api_key`）

**Interfaces:**
- Consumes: `fetch_model_rankings`、`RankingsResponse`（Task 7）；`AppType::all()`（`crate::app_config::AppType`，已有，返回全部 10 个变体）；`ProviderService::list(state: &AppState, app_type: AppType) -> Result<IndexMap<String, Provider>, AppError>`（在 `crate::services::provider`）；`resolve_native_credentials(&AppType, Option<&Provider>) -> (String, String)`（`commands/provider.rs` 里，返回值就是 `(base_url, api_key)`，取自 `provider.resolve_usage_credentials`）；`crate::settings::get_settings()`。
- 注意：命令要读 `AppSettings.openrouter_api_key`，这个字段在本任务 Step 4 里才加（前端侧的 `openrouterApiKey` 在 Task 12 加）。先把字段加了再写命令，否则编译不过。
- Produces:
  ```rust
  #[tauri::command]
  pub async fn get_openrouter_rankings(state: State<'_, AppState>, period: String) -> Result<RankingsResponse, String>
  ```

- [ ] **Step 1: 写失败测试（Key 解析是纯逻辑，单独抽出来测）**

```rust
#[cfg(test)]
mod tests {
    // resolve_openrouter_key_from(candidates: impl Iterator<Item = (String, String)>, fallback: Option<&str>) -> Option<String>
    #[test]
    fn uses_first_configured_openrouter_provider_key() { /* ("https://api.openai.com", "sk-a") 在前、("https://openrouter.ai/api/v1", "sk-or") 在后 → 取 "sk-or" */ }
    #[test]
    fn falls_back_to_settings_key_when_no_provider() { /* 空候选 + Some("sk-or-x") → 取 "sk-or-x" */ }
    #[test]
    fn ignores_blank_keys() { /* ("https://openrouter.ai/api/v1", "  ") → None */ }
    #[test]
    fn no_key_anywhere_returns_none() { /* 空候选 + None → None */ }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test get_openrouter_rankings`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

`src-tauri/src/commands/openrouter.rs`：

```rust
/// 把「候选 (base_url, api_key)」+ 「设置里手填的 Key」收成一个可用 Key。
/// 判据与 services/balance.rs 的 openrouter 检测一致：base_url 含 "openrouter.ai"。
pub(crate) fn resolve_openrouter_key_from(
    candidates: impl Iterator<Item = (String, String)>,
    fallback: Option<&str>,
) -> Option<String>
```

命令主体：

```rust
#[tauri::command]
pub async fn get_openrouter_rankings(
    state: State<'_, AppState>,
    period: String,
) -> Result<RankingsResponse, String> {
    let key = {
        let mut candidates: Vec<(String, String)> = Vec::new();
        for app_type in AppType::all() {
            if let Ok(map) = ProviderService::list(state.inner(), app_type.clone()) {
                for provider in map.values() {
                    candidates.push(resolve_native_credentials(&app_type, Some(provider)));
                }
            }
        }
        resolve_openrouter_key_from(
            candidates.into_iter(),
            crate::settings::get_settings().openrouter_api_key.as_deref(),
        )
    };

    let Some(key) = key else {
        // 无 Key 是确定性状态，不是瞬时失败：返回 Ok 而不是 Err，避免上层白白重试
        return Ok(RankingsResponse {
            status: "no_key".to_string(),
            message: None,
            as_of: None,
            rows: Vec::new(),
        });
    };

    fetch_model_rankings(&key, &period).await
}
```

1. `AppType::all()` 逐个 `ProviderService::list(state.inner(), app_type.clone())`（**注意 `list` 吃所有权，`app_type` 要 clone**），把每个供应商经 `resolve_native_credentials(&app_type, Some(&provider))` 展开成 `(base_url, api_key)`，收进 `Vec`。取列表失败就跳过该 app type（不因为一个 app 报错就整体失败）。
2. `resolve_openrouter_key_from(candidates.into_iter(), get_settings().openrouter_api_key.as_deref())`。
3. `None` → `Ok(RankingsResponse { status: "no_key", .. })`（**不要**返回 `Err`——无 Key 是确定性状态，不是瞬时失败，否则会白白重试）。
4. 有 Key → `fetch_model_rankings(&key, &period).await`。

- [ ] **Step 4: 给 `AppSettings` 加字段**

`src-tauri/src/settings.rs`：`AppSettings` 已有 `#[serde(rename_all = "camelCase")]`，所以 Rust 侧 `openrouter_api_key` 与前端 `openrouterApiKey` 自动对应，不需要额外 rename：

```rust
/// 全网榜（OpenRouter Data API）用；留空则自动使用已配置的 OpenRouter 供应商的 Key
#[serde(default, skip_serializing_if = "Option::is_none")]
pub openrouter_api_key: Option<String>,
```

`AppSettings` **没有** `#[derive(Default)]`，而是手写了 `impl Default for AppSettings`（`settings.rs` 里那个穷尽的 `Self { ... }` 字面量）——必须在里面补一行 `openrouter_api_key: None,`，否则编译不过。

- [ ] **Step 5: 注册命令并跑全量检查**

`src-tauri/src/lib.rs` 的 `generate_handler!` 列表里加 `commands::get_openrouter_rankings,`。

Run: `cd src-tauri && cargo test openrouter && cargo fmt --check && cargo clippy -- -D warnings`
Expected: 测试 PASS、fmt 干净、clippy 无 warning。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/commands/openrouter.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/provider.rs src-tauri/src/lib.rs src-tauri/src/settings.rs
git commit -m "feat(openrouter): 全网榜命令（供应商自动探测 → 设置兜底 → no_key）"
```

---

### Task 9: 全网榜聚合（前端纯函数）

**Files:**
- Modify: `src/types/usage.ts`（定义 `OpenRouterRankingRow` 与 `OpenRouterRankings` 两个数据形状）
- Create: `src/components/usage/rankings.ts`
- Test: `tests/components/rankings.test.ts`

**Interfaces:**
- Consumes: 无（本任务自己定义输入类型）。
- Produces:
  ```ts
  // @/types/usage —— 字段名走 camelCase，Rust 侧是 snake_case，Tauri 自动转换
  export interface OpenRouterRankingRow { date: string; model: string; totalTokens: number }
  export interface OpenRouterRankings {
    status: "ok" | "no_key" | "unauthorized" | "api_error";
    message?: string;
    asOf?: string;
    rows: OpenRouterRankingRow[];
  }

  // @/components/usage/rankings
  export type RankingsPeriod = "week" | "month";
  export const PERIOD_DAYS: Record<RankingsPeriod, number>;   // { week: 7, month: 30 }
  export interface LeaderboardRow { model: string; label: string; author: string; tokens: number; deltaPct: number | null; isNew: boolean }
  export interface AuthorShare { author: string; tokens: number; share: number }

  /** 以数据里的最大日期为基准切成「当前窗口 / 前一窗口」 */
  export function splitWindows(rows: readonly OpenRouterRankingRow[], period: RankingsPeriod): { current: OpenRouterRankingRow[]; previous: OpenRouterRankingRow[] };
  /** 当前窗口按模型聚合 + 环比；降序；不含 "other" */
  export function modelLeaderboard(rows: readonly OpenRouterRankingRow[], period: RankingsPeriod): LeaderboardRow[];
  /** 当前窗口按作者聚合份额；降序；含 "other"（作者记作 "other"） */
  export function authorShares(rows: readonly OpenRouterRankingRow[], period: RankingsPeriod): AuthorShare[];
  /** permaslug → 显示名（去掉作者前缀，保留 :variant 后缀）；无 "/" 时原样返回 */
  export function labelFromSlug(slug: string): string;
  ```

- [ ] **Step 1: 写失败测试**

```ts
// tests/components/rankings.test.ts
import { describe, expect, it } from "vitest";
import { authorShares, labelFromSlug, modelLeaderboard, splitWindows } from "@/components/usage/rankings";
import type { OpenRouterRankingRow } from "@/types/usage";

const row = (date: string, model: string, totalTokens: number): OpenRouterRankingRow => ({ date, model, totalTokens });

it("把 14 天切成两个 7 天窗口", () => {
  const rows = [row("2026-10-01", "a/b", 1), row("2026-10-07", "a/b", 2), row("2026-10-08", "a/b", 3), row("2026-10-14", "a/b", 4)];
  const { current, previous } = splitWindows(rows, "week");
  expect(current.map((r) => r.date)).toEqual(["2026-10-08", "2026-10-14"]);
  expect(previous.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-07"]);
});

it("month 周期用 30 天窗口", () => {
  const rows = [row("2026-09-01", "a/b", 1), row("2026-09-15", "a/b", 5), row("2026-10-05", "a/b", 9)];
  const { current, previous } = splitWindows(rows, "month");
  expect(current.map((r) => r.date)).toEqual(["2026-09-15", "2026-10-05"]);
  expect(previous.map((r) => r.date)).toEqual(["2026-09-01"]);
});

it("author 取 permaslug 前缀，label 去掉前缀并保留变体后缀", () => {
  expect(labelFromSlug("openai/gpt-4o:free")).toBe("gpt-4o:free");
  expect(labelFromSlug("other")).toBe("other");
  const r = modelLeaderboard([row("2026-10-10", "openai/gpt-4o:free", 7)], "week");
  expect(r[0]).toMatchObject({ model: "openai/gpt-4o:free", label: "gpt-4o:free", author: "openai" });
});

it("榜单不含 other 行", () => {          // Review Focus #3
  const r = modelLeaderboard([row("2026-10-10", "openai/gpt-4o", 100), row("2026-10-10", "other", 9999)], "week");
  expect(r.map((x) => x.model)).toEqual(["openai/gpt-4o"]);
});

it("变体按独立条目排名", () => {          // Review Focus #3
  const r = modelLeaderboard([row("2026-10-10", "openai/gpt-4o", 100), row("2026-10-10", "openai/gpt-4o:free", 5)], "week");
  expect(r.map((x) => x.model)).toEqual(["openai/gpt-4o", "openai/gpt-4o:free"]);
});

it("环比 = (当前 - 前一) / 前一", () => {
  const r = modelLeaderboard([row("2026-10-01", "a/b", 100), row("2026-10-08", "a/b", 300)], "week");
  expect(r[0].tokens).toBe(300);
  expect(r[0].deltaPct).toBeCloseTo(200, 10);   // 100 → 300 即 +200%
});

it("前一窗口为 0 时标为新增，deltaPct 为 null", () => {
  const r = modelLeaderboard([row("2026-10-10", "a/b", 500), row("2026-10-11", "a/b", 500)], "week");
  expect(r).toHaveLength(1);
  expect(r[0].isNew).toBe(true);
  expect(r[0].deltaPct).toBeNull();
});

it("份额按作者聚合并折算成占比，other 计入分母", () => {
  const rows = [row("2026-10-10", "openai/gpt-4o", 100), row("2026-10-10", "openai/gpt-4o-mini", 100), row("2026-10-10", "anthropic/claude", 100), row("2026-10-10", "other", 100)];
  const s = authorShares(rows, "week");
  expect(s.map((x) => x.author)).toEqual(["openai", "anthropic", "other"]);   // 同值时按作者名升序
  expect(s.map((x) => x.tokens)).toEqual([200, 100, 100]);
  expect(s[0].share).toBeCloseTo(0.4, 10);
  expect(s.reduce((acc, x) => acc + x.share, 0)).toBeCloseTo(1, 10);
});

it("超大数值不塌成 0 或 NaN", () => {      // Review Focus #5
  const r = modelLeaderboard([row("2026-10-10", "a/b", 1.2e13)], "week");
  expect(Number.isFinite(r[0].tokens)).toBe(true);
  expect(r[0].tokens).toBeGreaterThan(1e12);
});

it("空数组返回空结果", () => {
  expect(splitWindows([], "week")).toEqual({ current: [], previous: [] });
  expect(modelLeaderboard([], "week")).toEqual([]);
  expect(authorShares([], "week")).toEqual([]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/components/rankings.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 `rankings.ts`**

- 日期窗口切分与 `insights.ts` 同法（`Date.UTC` + 最大日期基准），窗口长度取 `PERIOD_DAYS[period]`。
- `modelLeaderboard`：先按模型聚合两窗口，再算 `deltaPct`；`previous === 0 && current > 0` → `isNew = true, deltaPct = null`；两边都 0 → 丢弃该行。排序 `tokens` 降序，同值按 `label` 升序。
- `authorShares`：按前缀聚合并除以总 token（含 `other`）；排序 `tokens` 降序，同值按 `author` 升序。
- 文件顶部注释写明：`total_tokens` 上游是十进制字符串，这里用 Number（显示只到 3 位有效数字，1e15 量级的尾数误差不影响），要精确需改 BigInt。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/components/rankings.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/types/usage.ts src/components/usage/rankings.ts tests/components/rankings.test.ts
git commit -m "feat(usage): 全网榜聚合（窗口切分 / 环比 / 作者份额）"
```

---

### Task 10: api + query hook

**Files:**
- Modify: `src/lib/api/usage.ts`（加 `getOpenRouterRankings`）
- Modify: `src/lib/query/usage.ts`（加 `usageKeys.openrouterRankings` + `useOpenRouterRankings`）

**Interfaces:**
- Consumes: `OpenRouterRankings`（Task 9 已加到 `@/types/usage`，不要重复定义）。
- Produces:
  ```ts
  // @/lib/api/usage
  getOpenRouterRankings: (period: "week" | "month") => Promise<OpenRouterRankings>
  // @/lib/query/usage
  export function useOpenRouterRankings(period: "week" | "month")
  ```

- [ ] **Step 1: 加 api 封装**

```

```ts
getOpenRouterRankings: async (period: "week" | "month"): Promise<OpenRouterRankings> =>
  invoke("get_openrouter_rankings", { period }),
```

- [ ] **Step 2: 加 query key 与 hook**

```ts
openrouterRankings: (period: string) => [...usageKeys.all, "openrouter-rankings", period] as const,
```

hook 要点：`staleTime: 6 * 60 * 60 * 1000`（日粒度数据，一天拉一次就够）、`refetchInterval: false`（**不要**继承默认 30 秒轮询，否则会白白打 API 配额）。retry 保持默认（瞬时网络错误会重试，确定性状态是 `Ok`，不会重试）。

- [ ] **Step 3: 确认类型与格式化**

Run: `pnpm typecheck && pnpm format && npx vitest run tests/components/rankings.test.ts`
Expected: typecheck exit 0、格式化无残差、Task 9 的测试仍然全绿。

- [ ] **Step 4: 提交**

```bash
git add src/lib/api/usage.ts src/lib/query/usage.ts
git commit -m "feat(usage): 全网榜查询接线（6h stale，不轮询）"
```

---

### Task 11: 全网榜面板 + 第 5 个 Tab

**Files:**
- Create: `src/components/usage/GlobalRankingsPanel.tsx`
- Modify: `src/components/usage/UsageDashboard.tsx`（`TABS` 加 `"global"`、`tabLabel` 加文案、tab 内容区加分支）
- Modify: `src/i18n/locales/*.json`
- Test: `tests/components/GlobalRankingsPanel.test.tsx`

**Interfaces:**
- Consumes: `useOpenRouterRankings`（Task 10）；`modelLeaderboard` / `authorShares` / `RankingsPeriod`（Task 9）；`formatTokensCompact`；`SegmentedControl`（`@/components/ui/segmented-control`）。
- Produces: `export function GlobalRankingsPanel(): JSX.Element`（内部自己取数，无 props）。

- [ ] **Step 1: 写失败测试**

```tsx
// mock @/lib/query/usage 的 useOpenRouterRankings，让每个用例直接给定返回值
// （参考 UsageDashboard.test.tsx 里 mock useProviderStats / useModelStats 的写法）
const row = (date: string, model: string, totalTokens: number) => ({ date, model, totalTokens });

const ok = (rows = [row("2026-10-10", "openai/gpt-4o", 100), row("2026-10-10", "anthropic/claude", 50)]) =>
  ({ data: { status: "ok", asOf: "2026-10-15", rows }, isLoading: false, error: null });

it("正常态渲染模型榜与厂商 token 份额", () => {
  // 断言出现 "gpt-4o"、"openai"、作者份额标题，以及 CC BY 4.0 链接
});
it("周/月切换后按新周期重新请求", () => {
  // 点「月」→ 断言 useOpenRouterRankings 最近一次收到的参数是 "month"
});
it("no_key 时给出配置引导，不显示表格", () => {       // Review Focus #4
  // 断言出现「去设置」引导、且表格头没有渲染
});
it("unauthorized 时提示 Key 无效", () => {});          // Review Focus #4
it("api_error 时把 message 显示出来并提供重试", () => {});
it("已有上次成功数据时请求失败，仍渲染旧榜单并标注错误", () => {
  // Review Focus #4：{ data: ok().data, isLoading: false, error: new Error("网络中断") }
  // 断言榜单仍在 + 错误提示出现（不能白屏，也不能静默假装数据是新的）
});
it("底部始终显示 OpenRouter 署名与 CC BY 4.0 链接", () => {
  // 断言文本含 "Source: OpenRouter (openrouter.ai/rankings), as of 2026-10-15."
  // 且链接 href 指向 https://openrouter.ai/rankings —— 这是 CC BY 4.0 的署名要求
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/components/GlobalRankingsPanel.test.tsx`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现组件与 Tab**

`GlobalRankingsPanel.tsx`：

1. 顶部：`SegmentedControl`（周 / 月）+ 右侧「刷新」按钮（`useQueryClient().invalidateQueries({ queryKey: usageKeys.openrouterRankings(period) })`）+ `数据截止 {asOf}`。
2. 模型调用量榜：表格，列 = 名次徽章（前三高亮）、模型（`label`，`title` 给完整 permaslug）、作者、tokens（`formatTokensCompact(tokens, locale)`，`title` 给精确值）、环比（`+N%` / `-N%` / 「新增」/ `—`）。
3. 厂商 token 份额：作者 + 百分比 + 条形。
4. 底部固定署名（**英文原文，不翻译**）：`Source: OpenRouter (openrouter.ai/rankings), as of {asOf}.` + 一个指向 `https://openrouter.ai/rankings` 的 CC BY 4.0 链接。
5. 状态分支：`no_key` → 空状态（一句引导 + 指向「设置」Tab 的按钮，通过现有 `onTabChange`/本地 state 切页）；`unauthorized` → Key 无效提示；`api_error` → `message` + 重试；加载中 → skeleton。
6. **瞬时失败保留上次数据**：react-query 在请求失败时会保留 `data`、同时把 `error` 置上，所以渲染顺序要是「先看有没有 `data`，有就照常渲染榜单，`error` 只额外加一条提示条」。**不要**写成 `if (error) return <ErrorState />`，那样刷新失败就会把已经拿到的榜单擦掉。

`UsageDashboard.tsx`：

- `UsageTab` 类型与 `TABS` 加 `"global"`，顺序 `logs / providers / models / global / settings`。
- tab 内容区加 `{tab === "global" && <GlobalRankingsPanel />}` 分支。

- [ ] **Step 4: 补五个语言文案**

`usage.global.*`：`tab`(全网榜) / `week`(周) / `month`(月) / `rank`(名次) / `model`(模型) / `author`(作者) / `tokens`(tokens) / `change`(环比) / `newEntry`(新增) / `authorShare`(厂商 token 份额) / `asOf`(数据截止 {date}) / `refresh`(刷新) / `noKey`(未找到 OpenRouter API Key；可在下方「设置」里填入，或先添加一个 OpenRouter 供应商) / `goSettings`(去设置) / `unauthorized`(OpenRouter API Key 无效或已过期) / `loadFailed`(加载失败：{message}) / `source`(数据来源)。

`usage.insights` 的 key 已在 Task 6 补齐。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/components/GlobalRankingsPanel.test.tsx tests/components/UsageDashboard.test.tsx && pnpm typecheck`
Expected: PASS、typecheck exit 0。

- [ ] **Step 6: 提交**

```bash
git add src/components/usage/GlobalRankingsPanel.tsx src/components/usage/UsageDashboard.tsx src/i18n/locales tests/components/GlobalRankingsPanel.test.tsx
git commit -m "feat(usage): 新增「全网榜」Tab（OpenRouter 实时数据 + 署名）"
```

---

### Task 12: 设置项 `openrouterApiKey` + 设置 Tab 卡片

**Files:**
- Modify: `src/types.ts:412` 附近（`Settings` 加 `openrouterApiKey?: string`）
- Modify: `src/hooks/useSettingsForm.ts`（把该字段纳入表单状态，与其他顶层字段同法）
- Modify: `src/components/usage/UsagePage.tsx`（透传 `openrouterApiKey` + `save`）
- Modify: `src/components/usage/UsageDashboard.tsx`（settings tab 加卡片）
- Create: `src/components/usage/OpenRouterSourceSection.tsx`
- Modify: `src/i18n/locales/*.json`
- Test: `tests/components/OpenRouterSourceSection.test.tsx`

**Interfaces:**
- Consumes: `Settings`（`@/types`）；Rust 侧 `AppSettings.openrouter_api_key`（Task 8 已加，字段名对应关系由 Tauri 自动转成 camelCase）。
- Produces:
  ```ts
  interface OpenRouterSourceSectionProps { value?: string; onSave: (value: string) => Promise<boolean> }
  export function OpenRouterSourceSection(props: OpenRouterSourceSectionProps): JSX.Element
  ```

- [ ] **Step 1: 写失败测试**

```tsx
it("输入框回显当前 Key", ...);
it("失焦时把新值交给 onSave", ...);
it("onSave 返回 false 时回滚成原值并保持界面可用", ...);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/components/OpenRouterSourceSection.test.tsx`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现**

- `src/types.ts`：`Settings` 加 `// 全网榜（OpenRouter Data API）用的 Key；留空则自动使用已配置的 OpenRouter 供应商的 Key` + `openrouterApiKey?: string;`。
- `src/hooks/useSettingsForm.ts`：比照 `sessionAutoSyncEnabled` 这类顶层可选字段的既有写法，把它纳入 `SettingsFormState` 与「从 settings 同步到表单」的逻辑（**注意**：Key 是敏感值，不要在 UI 上做任何日志输出）。
- `OpenRouterSourceSection.tsx`：一个卡片，标题「全网榜数据源」+ 受控输入框（`type="password"`，右侧可切换明文）+ 一行说明「留空则自动使用已配置的 OpenRouter 供应商；数据由 OpenRouter 公开 API 提供（CC BY 4.0）」。失焦 / 回车时调 `onSave`，失败回滚。
- `UsagePage.tsx`：传 `openrouterApiKey={settings?.openrouterApiKey}` 与 `onOpenrouterApiKeyChange={(openrouterApiKey) => save({ openrouterApiKey })}`。
- `UsageDashboard.tsx`：settings tab 里（`<PricingConfigPanel />` 附近）渲染 `<OpenRouterSourceSection value={openrouterApiKey} onSave={onOpenrouterApiKeyChange} />`。

- [ ] **Step 4: 补五个语言文案**

`usage.openrouterKey.*`：`title`(全网榜数据源) / `label`(OpenRouter API Key) / `placeholder`(留空则自动使用已配置的 OpenRouter 供应商) / `attribution`(数据由 OpenRouter 公开 API 提供，CC BY 4.0) / `saveFailed`(保存失败)。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/components/OpenRouterSourceSection.test.tsx && pnpm typecheck`
Expected: PASS、typecheck exit 0。

- [ ] **Step 6: 提交**

```bash
git add src/types.ts src/hooks/useSettingsForm.ts src/components/usage/UsagePage.tsx src/components/usage/UsageDashboard.tsx src/components/usage/OpenRouterSourceSection.tsx src/i18n/locales tests/components/OpenRouterSourceSection.test.tsx
git commit -m "feat(usage): 设置里加全网榜数据源（OpenRouter API Key）"
```

---

### Task 13: 全量验证

**Files:**
- 不改代码；产出验证结论。

- [ ] **Step 1: 前端全量**

Run: `cd D:\000Lxs\gitPjoj\cc-switch && pnpm typecheck && pnpm format:check && pnpm test:unit`
Expected: typecheck exit 0、format 无残差、前端测试全绿。
已知无关失败：`tests/components/rememberedChoice.test.ts > keeps working when storage is unavailable`——本机 Node 自带原生 `localStorage`，`tests/setupGlobals.ts` 的 polyfill 不生效，属环境问题，改动前后一致。**只要不是这条，其余都必须绿。**

- [ ] **Step 2: 后端全量**

Run: `cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test`
Expected: 全绿、无 warning。

- [ ] **Step 3: 五语言 key 齐全性**

先说明：`tests/config/localeCoverage.test.ts` **只校验 Pi 相关的 key**，不会发现 `usage.*` 漏译，所以这一关必须手工核对。以 `en` 为基准，检查五份 locale 的 key 集合：

```powershell
node -e "const fs=require('fs');const f=n=>JSON.parse(fs.readFileSync('src/i18n/locales/'+n+'.json','utf8'));const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?flat(v,p+k+'.'):[p+k]);const K=Object.fromEntries(['zh','zh-TW','en','ja','tr'].map(n=>[n,new Set(flat(f(n)))]));for(const n of Object.keys(K)){const missing=[...K.en].filter(k=>!K[n].has(k)&&k.startsWith('usage.'));console.log(n,'usage 段缺少',missing.length,missing.join(' '));}"
```

Expected: `zh` / `zh-TW` / `en` / `ja` 四行都是 `usage 段缺少 0`；`tr` 一行**本来就缺 20 个**（`usage.display.*` 与 `usage.logColumns.*`，是本轮改动之前就有的历史欠账，与本次无关）：

```
tr usage 段缺少 20 usage.display.title usage.display.currency ... usage.logColumns.duration
```

判定标准：`tr` 的缺失列表**必须与上面这 20 个完全一致**，不能出现本轮新增的任何 key（`usage.firstPage` / `usage.lastPage` / `usage.estimate.*` / `usage.insights.*` / `usage.global.*` / `usage.openrouterKey.*`）。**历史欠账不在本轮修**，别为它混进无关 diff。

然后额外跑一遍既有的 locale 用例确认没被弄坏：

Run: `npx vitest run tests/config/localeCoverage.test.ts tests/config/toolManagementLocales.test.ts`
Expected: PASS。

- [ ] **Step 4: 构建（可选，按需）**

Run: `New-Item -ItemType Directory src-tauri\target -Force`（`src-tauri/target` 必须存在，否则 Tauri `build.rs` 读插件权限文件会报 `os error 3`），然后
`$env:CARGO_TARGET_DIR="D:\000Lxs\gitPjoj\.build-target-4"; $env:RUSTUP_TOOLCHAIN="stable"; pnpm tauri build`
Expected: 产出 `cc-switch.exe` 与安装包。末尾 `A public key has been found, but no private key` 只是本地没配更新签名，**不是失败**。产物时间戳按 `yyyyMMddHHmmss` 报告。

- [ ] **Step 5: 汇总**

列出：跑过的命令与结果、新增/改动文件清单、以及任何未覆盖的已知问题（例如全网榜需要一个真实 OpenRouter Key 才能人肉验证，本轮未联网实测）。
