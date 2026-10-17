# 用量页扩展：估算价格 · 个人洞察 · 全网榜

- 日期：2026-10-17
- 状态：待评审
- 目标仓库：`D:\000Lxs\gitPjoj\cc-switch`（分支 `merge-orca-custom`）
- 参考稿：`docs/llm_cost_panel.html`、`docs/全网Token看板.html`、`docs/Token用量排行榜-OpenRouter公开数据.pdf`

## 1. 目标与背景

用量统计页目前只有「自己的数据」：`UsageHero` 指标卡（+ 更多指标）、趋势图 / 热力图、四个 Tab（日志 / 供应商 / 模型 / 设置）。

三份参考稿对应三块新增内容：

| 参考稿 | 新增块 |
| --- | --- |
| `llm_cost_panel.html` | 「估算价格」：选若干大模型，用真实 token 算出各家分别要花多少 |
| `全网Token看板.html` | 「个人使用量」洞察：零费用占比 / 最贵模型 / 最贵供应商 / 环比 |
| `Token用量排行榜…pdf` | 「全网榜」：OpenRouter 公开的全球模型调用量榜 |

成功标准：三块内容都落在**现有用量页内**，不新开页面；估算价格紧跟指标区；洞察一眼可读；全网榜数据真实、可署名、没有 Key 时不崩。

## 2. 已确认的三个决定

1. 模型没配缓存单价时，缓存 token **按 0 计**，行内加提示。
2. 洞察为 **4 项**。
3. 全网榜 Key：**先自动探测已配置的 OpenRouter 供应商，探测不到用「用量统计 → 设置」手填的兜底**；位置＝**新增第 5 个 Tab**。

## 3. 非目标

- 不做 PDF 里的「智能指数 Top」（Artificial Analysis 基准分，是另一个数据集）。
- v1 不做「应用 / 智能体榜」（要另一个端点 `/api/v1/datasets/app-rankings`），留 v2。
- 不改动现有指标卡、趋势图、热力图的口径与算法。
- 不引入新的密钥存储机制；不做跨设备同步；不上传任何用户本地数据。

## 4. 功能设计

页面顺序（`UsageDashboard` 主内容区）：

```
UsageHero（指标卡 + 更多指标）
PriceEstimatePanel（估算价格）        ← 新增，就在「更多指标」正下方
UsageInsights（洞察 4 格）            ← 新增
UsageTrendChart / UsageHeatmap（现有）
tabsSection（日志 / 供应商 / 模型 / 全网榜 →新增 / 设置）
```

### 4.1 估算价格（`PriceEstimatePanel`）

自上而下：标题行 → **大模型多选框** → **估算价格结果**。

- 标题：`估算价格` + `HelpTip`（说明：用你真实的 token 口径 × 候选模型单价估算）。
- 多选框：数据来自 `useModelPricing()`（应用现有「模型定价」表，models.dev 同步 + 手动录入）。模型可能很多，做成带搜索的下拉多选（`popover` + `command` + `checkbox`，参考 `ModelsDevPickerDialog` 的既有做法，不新造轮子）。
- 结果区：
  - 一行摘要：`最省：<模型> <金额> · 省 N%`，N = 相对**当前勾选里最贵的那档**省下的百分比。
  - 表格：`模型 / 估算总价 / 相对成本条`，按估算总价升序；成本条宽度 = 该模型估算价 ÷ 当前勾选中的最高估算价。

组件接收与 `UsageHero` 相同的筛选 props（`range` / `appType` / `providerName` / `model`），保证落到同一个 query 缓存条目。

口径与算法：

- token 口径 = 当前筛选（时间范围 + 供应商 + 模型）下的真实用量：新增输入 / 输出 / 缓存写入 / 缓存命中。
  取自 `useUsageSummaryByApp(range, { providerName, model })`，**与 `UsageHero` 同一 queryKey**，react-query 去重，不发第二次请求。注意要传和 Hero 完全相同的参数（只传 `providerName` / `model`，不传 appType；appType 在客户端用 `pickSummary` 过滤）。
- 单价 = `ModelPricing` 的四项，单位「每百万 token 的美元」。
- 计算：`(输入×in + 输出×out + 缓存写入×cw + 缓存命中×cr) / 1e6`。
  - 单价是字符串，用 `parseFiniteNumber` 解析；缺失 / 非有限值按 0。
  - `cw` / `cr` 缺失 → 按 0，并标记 `hasCachePricing=false` 供行内提示。
- 默认勾选：当前区间用量最高的 5 个模型（复用页面已取的 `useModelStats`，按 `requestCount` 降序），只保留能在定价表里找到的；一个都匹配不上时回落到定价表前 5 个。
- 显示币种：`useMoneyFormat()`（跟随用户设置的显示币种与汇率）。
- 空状态：定价表为空 → 复用现有 `usage.empty.configurePricing` 文案与跳转；多选框为空 → 一句提示。

改动：

- 新增 `src/components/usage/estimateCost.ts`（纯函数：`estimateModelCost`、`estimateAll`、`TokenBreakdown`、`PriceEstimate`）。
- 新增 `src/components/usage/PriceEstimatePanel.tsx`。
- 把 `UsageHero.tsx` 里的 `pickSummary`（及合并逻辑）抽到 `src/components/usage/usageSummary.ts`，两处复用。

### 4.2 个人使用量洞察（`UsageInsights`）

4 格（`compact` 时 2 列）：

| 项 | 口径 | 来源 |
| --- | --- | --- |
| 零费用 token 占比 | `Σ tokens(cost == 0) / Σ tokens` | `useModelStats` |
| 最贵模型 | `max(totalCost)` | `useModelStats` |
| 最贵供应商 | `max(totalCost)` | `useProviderStats` |
| 近 7 日 vs 前 7 日 | 环比 `+12%` / `-8%` / `新增` / `—` | `useUsageTrends`（独立的自定义 14 天窗口） |

- 措辞：mockup 叫「免费平台 token 占比」，但本地库里 `cost == 0` 既可能是真免费、也可能是没配定价，所以标题写「零费用」，`HelpTip` 里说明这一点。
- 环比是固定「近 7 日 vs 前 7 日」，**不跟随页面当前时间范围**（否则选 7 天时拿不到前 7 天）。实现用一次 `useUsageTrends({ preset: "custom", 覆盖最近 14 天 })` 请求，拿到的日粒度数据切两半求和。请求失败或数据不足 → 该项显示 `—`。
- 组件从父级接收 `range` 的筛选结果，只在有数据时渲染，失败不阻塞其它块。

改动：新增 `src/components/usage/UsageInsights.tsx`。

### 4.3 全网榜（OpenRouter 实时）

#### 4.3.1 后端

新增 `src-tauri/src/services/openrouter_rankings.rs` 与命令 `get_openrouter_rankings`（在 `lib.rs` 的 `generate_handler!` 注册）。

- 请求：`GET https://openrouter.ai/api/v1/datasets/rankings-daily?period={week|month}`，头 `Authorization: Bearer <key>`、`Accept: application/json`，超时 15s，复用 `crate::proxy::http_client::get()`（与 `services/balance.rs` 同一客户端策略）。
- 错误语义**沿用 `services/balance.rs` 的既有约定**：
  - `Err(String)` = 瞬时传输失败（网络不可达 / 超时 / 读体中断）→ 前端 invoke reject，react-query 重试并保留上一次成功的 data。
  - `Ok` + `status` = 确定性结果，立即透出文案。
- 取体顺序：先 `resp.bytes()` 再 `serde_json::from_slice`，把「读体失败（瞬时）」与「解析失败（确定性）」分开——`reqwest::json()` 无法区分。
- Rust 只做「取数 + 校验 + 原样透出」，**聚合放前端**（纯函数、vitest 可测）。

```rust
#[derive(Serialize)]
pub struct RankingsResponse {
    status: &'static str,      // "ok" | "no_key" | "unauthorized" | "api_error"
    message: Option<String>,
    as_of: Option<String>,     // meta.as_of
    start_date: Option<String>,
    end_date: Option<String>,
    rows: Vec<RankingRow>,     // 原始日粒度行
}

#[derive(Serialize)]
pub struct RankingRow {
    date: String,
    model: String,             // model_permaslug；保留 "other" 原样
    total_tokens: u64,         // 上游是十进制字符串，解析成整数
}
```

Key 解析（Rust 侧，避免把密钥拼进前端请求）：

1. 遍历各 `AppType` 的供应商（`ProviderService::list` + `commands::provider::resolve_native_credentials`），取第一个 base_url 命中 `openrouter.ai` 且 Key 非空的；
2. 否则读设置里的 `openrouterApiKey`；
3. 都没有 → `status: "no_key"`。

401 / 403 → `status: "unauthorized"`；其它非 2xx → `status: "api_error"` + 状态码与响应体片段。

#### 4.3.2 前端

- `src/lib/api/usage.ts`：`getOpenRouterRankings(period)` → `invoke("get_openrouter_rankings", { period })`。
- `src/lib/query/usage.ts`：`usageKeys.openrouterRankings(period)`、`useOpenRouterRankings(period)`，`staleTime: 6 小时`。
- `src/components/usage/rankings.ts`（纯函数）：
  - `splitWindows(rows, period)`：把 2×N 天的行切成「前一窗口 / 当前窗口」。
  - `modelLeaderboard(rows, period)`：按模型聚合两窗口 token 并算环比；模型的作者从 permaslug 前缀取。
  - `authorShares(rows, period)`：按作者聚合当前窗口 token 占比。
  - `"other"` 行单独处理（只进总量，不进榜单）。
- `src/components/usage/GlobalRankingsPanel.tsx`：
  - 顶部 `SegmentedControl`：周 / 月；右侧「刷新」按钮 + 「数据截止 {as_of}」。
  - 模型调用量榜：名次徽章（前 3 高亮）、模型、作者、tokens（`formatTokensCompact`）、环比。
  - 厂商 token 份额：条形列表。
  - 底部固定署名：`Source: OpenRouter (openrouter.ai/rankings), as of {as_of}.`（**英文原文，不翻译**）+ CC BY 4.0 链接。
  - 状态：`no_key` → 空状态 + 引导去「设置」Tab 填 Key；`unauthorized` → Key 无效；`api_error` → 错误文案 + 重试；瞬时错误 → 保留上次数据并标注。
- Tab：`TABS` 增加 `"global"`，顺序 `logs / providers / models / global / settings`。

#### 4.3.3 口径与合规

- **厂商份额按 token**：OpenRouter 官网的「厂商请求份额」是按请求数算的，这份数据集只有 token，所以标题如实写「厂商 **token** 份额」。
- **请求量**：一次请求覆盖 2×N 天（week → 14 天，month → 60 天），`staleTime` 6h + 手动刷新 → 远低于 30 次/分、500 次/天的限流。
- **署名**是 CC BY 4.0 的许可要求，不能省。

### 4.4 分页加首页 / 尾页

`TablePagination` 现在是「总数 · 上一页 · 页码 · 下一页」。加「首页」（`ChevronsLeft`）与「尾页」（`ChevronsRight`），各带 `HoverTip` + `aria-label`，禁用条件分别同上一页 / 下一页。**仅当 `totalPages > 1` 时**显示四个导航按钮（对应「多页时」）。这是用量页所有表格共用的组件，改一处全部受益。

新 i18n 键：`usage.firstPage`、`usage.lastPage`。

### 4.5 新增设置项

`Settings.openrouterApiKey?: string`（明文存于应用设置文件，与现有供应商 Key 同处，不引入新的密钥存储）。经现有通路下发：`UsagePage` 的 `save(partial)` → `UsageDashboard` → 「设置」Tab 新增卡片「全网榜数据源」（Key 输入框 + 说明「留空则自动使用已配置的 OpenRouter 供应商」）。

## 5. i18n

zh / zh-TW / en / ja / tr 五份都要补齐（漏译文不会让构建失败，只会静默回退英文）。新增键：

- `usage.estimate.*`：标题、选择模型、最省、省 N%、模型、估算价格、未配缓存单价、选择提示、空定价表
- `usage.insights.*`：零费用占比、最贵模型、最贵供应商、环比 + 各自 help
- `usage.global.*`：Tab 名、周 / 月、名次、模型、作者、tokens、环比、厂商 token 份额、数据截止、刷新、无 Key 引导、Key 无效、加载失败、署名标签
- `usage.firstPage`、`usage.lastPage`、`usage.openrouterKey.*`

## 6. 测试

- `estimateCost.test.ts`：四项口径、缓存缺失按 0、排序、异常输入（字符串 / 空 / NaN）。
- `rankings.test.ts`：窗口切分与环比、作者聚合、`other` 行处理、空数据。
- `PriceEstimatePanel.test.tsx`：默认勾选、结果排序、空定价表。
- `UsageInsights.test.tsx`：四项取值、环比三种文案、数据不足显示 `—`。
- `GlobalRankingsPanel.test.tsx`：周 / 月切换、`no_key` / `unauthorized` / 正常态、署名存在。
- `TablePagination.test.tsx`：单页时四按钮不显示；多页时首页 / 尾页跳转与禁用。
- Rust：`openrouter_rankings.rs` 的响应解析与各错误分支单测（喂样例 JSON，不打网络）。

## 7. 分期

- **v1（本 spec）**：估算价格、洞察 4 项、全网榜（模型榜 + 厂商 token 份额）、分页首尾页。
- **v2**：应用 / 智能体榜（`/api/v1/datasets/app-rankings`）。

## 8. 风险

1. **数据精度**：`total_tokens` 是十进制字符串，前端用 Number 聚合，累计到 1e16 量级会掉最后几位。显示只到 3 位有效数字，不影响；日后要精确可改 BigInt。
2. **环比口径**：固定「近 7 日 vs 前 7 日」，与官网 trailing window 定义一致；前一窗口为 0 时显示「新增」。
3. **端点稳定性**：OpenRouter Data API 是文档化接口但需要 Key；失败时保留上次成功数据并标注，不静默显示旧数据。
4. **厂商份额口径**：官网按请求数、我们按 token，已在标题如实区分。
5. **Key 明文存储**：与现有供应商 Key 一致，属既有设计而非本 spec 引入。
