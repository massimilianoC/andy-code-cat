# Cost Analytics Dashboards — Full Specification

**Status:** Draft v1.0
**Date:** 2026-05-14
**Author:** Architecture team
**Branch target:** `feat/cost-analytics-dashboards` from `develop`
**Depends on:**
- `COST_TRANSACTION_LEDGER_SPEC.md` — ledger schema, `ResourceType` enum, `CostTransactionService`
- `SUPER_ADMIN_SPEC.md` — superadmin role, admin route surface, `requireSuperAdmin` middleware
- Current implementation: `GET /v1/users/me/cost`, `GET /v1/admin/cost/dashboard`, `GET /v1/admin/cost/transactions`, `PATCH /v1/admin/cost/rates`

---

## 1. Overview

This spec defines **two complementary cost analytics surfaces**:

| Surface | Audience | Route | Scope |
|---|---|---|---|
| **User Usage Dashboard** | Authenticated user | `/dashboard/usage` or sidebar tab | User's own spend, broken down by project, resource type, and model |
| **Admin Cost Intelligence** | Superadmin | `/admin/cost` | Platform-wide multi-dimensional cost explorer across providers, models, users, and projects |

Both surfaces read exclusively from the `cost_transactions` ledger via already-implemented API endpoints plus new aggregations defined in §6.

---

## 2. Design Philosophy

### 2.1 Data Primacy

All numbers shown are derived from the immutable `cost_transactions` ledger.  
No estimates, no cached counters on User documents.  
Every KPI is reproducible by running the same aggregation query.

### 2.2 Progressive Disclosure

- **Level 0 (glance):** three KPI cards — total spent, this month, transactions.
- **Level 1 (scan):** charts and ranked lists per dimension.
- **Level 2 (drill):** tab switch reveals provider-level or model-level detail.
- **Level 3 (raw):** Transactions tab shows the full filterable ledger.

### 2.3 Metric Definitions (shared vocabulary)

| Term | Definition |
|---|---|
| **Gross Cost** | `totalEur` — the amount the platform charges the user (provider + infra + markup) |
| **Net Provider Cost** | `providerCostEur` — what the platform actually paid the provider |
| **Gross Margin** | `(totalEur − providerCostEur) / totalEur × 100` |
| **Token Efficiency** | `totalEur / totalTokens × 1000` — EUR per 1 000 tokens |
| **Cost Velocity** | `totalEur / days` — average daily spend rate over a period |
| **Concentration Ratio** | share of spend by top-N items (users, projects, or models) |

---

## 3. User Usage Dashboard

### 3.1 Route & Navigation

- **Route:** `/dashboard/usage`
- **Access:** any authenticated user; data is sandbox-scoped (own userId only via `GET /v1/users/me/cost`)
- **Entry point:** a new **"Usage"** link in the user sidebar (between "Projects" and "Settings")
- **Mobile:** all charts collapse to a vertical stack; the project table truncates to top 5 with a "Show all" expansion

### 3.2 Page Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Usage                                      [Period picker: 30d ▾]  │
├───────────────┬───────────────┬─────────────────────────────────────┤
│  Total Spent  │  This Month   │  Transactions                       │
│  €0.0000      │  €0.0000      │  0                                  │
├───────────────┴───────────────┴─────────────────────────────────────┤
│  Spend Over Time (30-day line chart)                                 │
├──────────────────────────────┬──────────────────────────────────────┤
│  Projects                    │  By Resource Type                    │
│  (ranked table)              │  (donut + legend)                    │
├──────────────────────────────┴──────────────────────────────────────┤
│  Top Models by Cost (horizontal bar chart)                          │
├─────────────────────────────────────────────────────────────────────┤
│  Recent Transactions (last 10 rows) [View all →]                    │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.3 KPI Cards

| Card | Value | Sub-line |
|---|---|---|
| **Total Spent** | `summary.totalEur` (all time, formatted EUR) | `Gross cost · {txCount} transactions` |
| **This Month** | `summary.totalEur` for current calendar month | `+{delta}% vs last month` (computed client-side from trend data) |
| **Transactions** | `summary.txCount` | `{providerCostEur} provider · {platformMarkupEur} markup` |

Period picker (`7d`, `30d`, `90d`, `All`) drives re-fetch of all widgets on the page.  
Default: `30d`.

### 3.4 Spend Over Time Chart

- **Type:** Area line chart (single series)
- **X axis:** date (`CostTrendPointDto.date`)
- **Y axis:** EUR (€)
- **Data source:** `GET /v1/users/me/cost` → `trend` array
- **Tooltip:** date, totalEur, txCount

When the period filter changes, the client re-fetches with `?days=7|30|90` (new query param, see §6.1).

### 3.5 Projects Table

**Data source:** `GET /v1/users/me/cost` → `topProjects` (extended, see §6.1)

| Column | Value | Notes |
|---|---|---|
| Project | project name (resolved client-side from `/v1/projects`) | links to `/workspace?projectId=X` |
| Spent (EUR) | `totalEur` | right-aligned, `tabular-nums` |
| Transactions | `txCount` | |
| Provider Share | `providerCostEur / totalEur` % | progress bar |
| Last Activity | `lastActivityAt` | relative time |

- Default sort: `Spent (EUR)` descending
- Show top 10; paginate or "Show more" beyond that
- Empty state: "No projects with recorded costs yet."

### 3.6 By Resource Type Donut

- **Type:** Donut / pie chart
- **Data source:** `GET /v1/users/me/cost` → `breakdown`
- **Segments:** one per `ResourceType` group — use display group labels (LLM, Image, Video, Compute, Platform)
- **Legend:** label + EUR amount + percentage
- **Click:** drills into that group (future, v2)
- **Fallback:** if all costs are zero, show an empty-state message, not an empty chart

Color palette (fixed per group, dark-theme safe):

| Group | Color token |
|---|---|
| LLM | `hsl(250 70% 60%)` (violet) |
| Image | `hsl(340 70% 60%)` (rose) |
| Video | `hsl(30 80% 55%)` (amber) |
| Compute | `hsl(200 60% 55%)` (cyan) |
| Platform | `hsl(150 55% 50%)` (emerald) |

### 3.7 Top Models Bar Chart

- **Type:** Horizontal bar chart
- **Data source:** `GET /v1/users/me/cost/top-models` — new endpoint, see §6.1
- **Each bar:** model display name (from `resourceSubtype`)
- **Value:** `totalEur`
- **Sub-line per bar:** `{totalTokens / 1000}k tokens · {tokenEfficiency} €/1k`
- **Max bars:** 10
- **Tooltip:** provider name (from first segment of `resourceSubtype`, e.g. `siliconflow` vs `openrouter`), txCount

### 3.8 Recent Transactions

- **Data source:** `GET /v1/projects/:projectId/cost/transactions?limit=10` iterated across top projects, OR a new `GET /v1/users/me/cost/transactions?limit=10` endpoint (§6.1)
- **Columns:** Date, Project, Type, Model, EUR, Status
- **Status badge:** `settled` = muted green; `voided` = muted red
- **"View all →"** link: navigates to `/dashboard/usage/transactions` (full paginated view, same columns plus filters)

---

## 4. Admin Cost Intelligence Dashboard

### 4.1 Route & Navigation

- **Route:** `/admin/cost`
- **Nav item:** add `"Cost Intelligence"` to `NAV_LINKS` in `apps/web/app/admin/layout.tsx`
- **Access:** `superadmin` role (client-side guard mirrors existing admin layout pattern)

### 4.2 Page Structure

The page is a **multi-tab interface** with a persistent **Global Filter Bar** pinned below the page title.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Cost Intelligence                                                   │
├─────────────────────────────────────────────────────────────────────┤
│  [Date range ▾] [Provider ▾] [Model ▾] [User ▾] [Project ▾] [Type ▾]│
│  ─────────────────────────────────────────────────────── [Reset]    │
├─────────────────────────────────────────────────────────────────────┤
│  Overview │ By Provider │ By Model │ By User │ By Project │ Ledger │ Correlations │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   (tab content — see §4.3 – §4.9)                                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.3 Global Filter Bar

All filters are optional and composable.  Changing any filter refetches all visible widgets on the active tab.

| Filter | Type | Values / Source |
|---|---|---|
| **Date range** | date-range picker | presets: Today, 7d, 30d, 90d, 12m, All time; custom start/end |
| **Provider** | multi-select | `siliconflow`, `openrouter`, `internal` — derived from `meta.provider` (new aggregation, §6.2) |
| **Model** | multi-select (searchable) | top models seen in ledger → `resourceSubtype` values |
| **User** | single-select (searchable) | user list from `/v1/admin/users` — display `email` |
| **Project** | single-select (searchable) | project list from `/v1/admin/projects` |
| **Resource Type** | multi-select | full `ResourceType` enum + group-level shortcuts (All LLM, All Image …) |

Filter state is reflected in the URL as query parameters to allow link-sharing.

---

### 4.4 Overview Tab

**Purpose:** Executive summary. Answers "How is the platform performing cost-wise right now?"

#### 4.4.1 KPI Row (6 cards)

| Card | Metric | Formula |
|---|---|---|
| **Platform Revenue** | `totalEur` (all active filters) | sum of `totalEur` |
| **Provider Cost** | `providerCostEur` | sum of `providerCostEur` |
| **Gross Margin** | `(totalEur − providerCostEur) / totalEur × 100` | — |
| **Active Users** | count of distinct `userId` with at least 1 tx in period | — |
| **Transactions** | `txCount` | sum of `txCount` |
| **Avg Cost / User** | `totalEur / activeUsers` | — |

Each card shows a sparkline (7-day micro-trend) and a `+X%` delta vs the preceding equivalent period.

#### 4.4.2 Revenue & Provider Cost Trend

- **Type:** Multi-line chart
- **Series:** `Platform Revenue (totalEur)` and `Provider Cost (providerCostEur)`
- **X axis:** date
- **Y axis:** EUR
- **Fill:** semi-transparent area fill between the two lines (margin visualisation)
- **Data source:** `GET /v1/admin/cost/analytics/trend` (§6.2)

#### 4.4.3 Spend by Resource Group (stacked bar)

- **Type:** Stacked bar chart, one bar per day (or week for 90d+)
- **Stacks:** LLM / Image / Video / Compute / Platform (using same color tokens as §3.6)
- **Data source:** `GET /v1/admin/cost/analytics/trend-by-group` (§6.2)
- **Tooltip:** date, total, per-group breakdown

#### 4.4.4 Top 5 Quick Lists

Three side-by-side compact ranked lists:

| List | Items | Metric |
|---|---|---|
| Top Projects | 5 projects | `totalEur` DESC |
| Top Users | 5 users | `totalEur` DESC |
| Top Models | 5 models (`resourceSubtype`) | `totalEur` DESC |

Each row shows: rank badge, name, EUR amount, share bar (% of filtered total).  
Click → navigates to corresponding dimension tab with that item pre-selected.

---

### 4.5 By Provider Tab

**Purpose:** Compare provider cost share, margin, and efficiency.

**Note:** Provider identity is not a first-class field in the current schema.  
It is derived from `meta.provider` (set by `CostTransactionService` via the calling service).  
This tab requires `meta.provider` to be present on LLM transactions (currently populated by the SiliconFlow and OpenRouter integrations).

#### 4.5.1 Provider Summary Table

| Column | Description |
|---|---|
| Provider | display name |
| Transactions | txCount |
| Provider Cost (EUR) | `providerCostEur` |
| Platform Revenue (EUR) | `totalEur` |
| Gross Margin % | `(totalEur − providerCostEur) / totalEur` |
| Avg Cost per Call | `providerCostEur / txCount` |
| Tokens (M) | `sum(totalTokens) / 1 000 000` |
| Efficiency | EUR / 1k tokens |

#### 4.5.2 Provider Cost Split Donut

- One segment per provider
- Metric toggleable: Provider Cost vs Platform Revenue

#### 4.5.3 Provider Cost Over Time

- Multi-line chart, one line per provider
- Useful for detecting provider pricing changes or traffic shifts

#### 4.5.4 Provider vs Estimate Accuracy

For providers that report actual cost (OpenRouter), compare `providerCostEur` (actual) vs  
the estimated cost computed from token count × rate snapshot.

- **Type:** scatter plot (x = estimated, y = actual, one point per transaction sample)
- **Ideal line:** y = x
- **Points above the line:** actual was more expensive than estimated (under-billing risk)
- **R² value:** displayed as a KPI card ("Estimate accuracy")
- **Data source:** `GET /v1/admin/cost/analytics/estimate-accuracy` (§6.2)

This chart is the primary tool for the "real cost vs estimated cost" comparison test the operator wants to run with SiliconFlow.

---

### 4.6 By Model Tab

**Purpose:** Understand which models drive cost and whether token efficiency justifies their use.

#### 4.6.1 Model Cost Table

| Column | Description |
|---|---|
| Model (`resourceSubtype`) | display name |
| Provider | derived from `meta.provider` |
| Transactions | |
| Total EUR | |
| Provider Cost EUR | |
| Gross Margin % | |
| Prompt Tokens | |
| Completion Tokens | |
| Total Tokens | |
| Token Efficiency | EUR / 1k tokens |
| Avg Latency (ms) | from `meta.latencyMs` if present |

- Default sort: Total EUR DESC
- Clicking a model row filters all charts to that model
- Column sort on all numeric columns

#### 4.6.2 Model Spend Share (donut)

#### 4.6.3 Model Cost Trend (multi-line, top 5 models)

#### 4.6.4 Prompt vs Completion Token Split (stacked bar per model)

Shows for each model: proportion of cost attributable to prompt tokens vs completion tokens.  
Useful for prompt engineering optimization decisions.

#### 4.6.5 Model Efficiency Scatter

- X axis: total tokens consumed (log scale)
- Y axis: EUR / 1k tokens
- One point per model
- Bubble size: transaction count
- Quadrants labeled: "High volume, efficient" / "High volume, expensive" / "Low volume, cheap" / "Low volume, expensive"

---

### 4.7 By User Tab

**Purpose:** Understand user-level cost concentration, identify high spenders, and detect anomalies.

#### 4.7.1 User Cost Table

| Column | Description |
|---|---|
| User | email + avatar initials |
| Plan | from `users.limits.plan` |
| Transactions | |
| Total EUR | |
| Provider Cost EUR | |
| Markup EUR | |
| Avg per Transaction | `totalEur / txCount` |
| Primary Resource Type | most-used `resourceType` (mode) |
| Last Activity | relative |

- Default sort: Total EUR DESC
- Click → opens a **User Cost Detail** side panel (§4.7.3)

#### 4.7.2 Concentration Analysis (Pareto)

- **Type:** Dual-axis chart: left axis = cumulative EUR %, right axis = per-user EUR
- **X axis:** users sorted by totalEur DESC (anonymised as "User 1", "User 2" … for security)
- **Purpose:** visually identify the 20% of users that generate 80% of cost
- **80% line:** dashed horizontal reference line on cumulative axis

#### 4.7.3 User Cost Detail Side Panel

Opened by clicking a user row in §4.7.1.  Contains:

- User identity header (email, roles, plan, joined date)
- KPI row: Total EUR, This Period EUR, Transaction Count, Top Resource Type
- 30-day spend trend (mini line chart)
- Breakdown by resource type (donut)
- Top projects for this user (ranked table)
- Top models for this user (ranked bar chart)
- Last 10 transactions (compact table)
- Direct link to full ledger filtered to this user

#### 4.7.4 User Spend Anomaly Indicators

Simple rule-based flags (no ML required in v1):

- **Spike:** a user's daily spend exceeds 3× their 14-day moving average on any day in the period
- **New High:** a user's this-period total exceeds all previous periods
- **Dormant → Active:** a user with no transactions in the last 30 days who now has transactions

Flag badges displayed in the User Cost Table (§4.7.1) as small colored dots with tooltip.

---

### 4.8 By Project Tab

**Purpose:** Understand project-level economics and identify high-cost or high-velocity projects.

#### 4.8.1 Project Cost Table

| Column | Description |
|---|---|
| Project | name |
| Owner | user email |
| Transactions | |
| Total EUR | |
| Provider Cost EUR | |
| Cost Velocity | EUR / day over the selected period |
| Primary Type | dominant `resourceType` |
| Last Activity | relative |

#### 4.8.2 Project Cost Share Donut

#### 4.8.3 Project Cost Trend (multi-line, top 5 projects)

#### 4.8.4 Project Detail Side Panel

Same pattern as User Detail (§4.7.3) but scoped to a project:

- Project identity header (name, owner, created)
- KPI row
- Spend trend
- Breakdown by resource type
- Top models used
- Last 10 transactions

---

### 4.9 Ledger Tab

**Purpose:** Raw, unfiltered access to every transaction. Full-power exploration tool.

**Data source:** `GET /v1/admin/cost/transactions` (already implemented)

#### 4.9.1 Filter Controls (inline, above the table)

All Global Filter Bar filters apply plus:

- **Status:** `settled` | `voided` | both
- **Min EUR / Max EUR:** numeric range
- **Has provider cost:** toggle to show only transactions where `providerCostUsd > 0`

#### 4.9.2 Transaction Table

| Column | Description |
|---|---|
| txId | monospace, click to copy |
| Date | ISO datetime, sortable |
| User | email |
| Project | name |
| Resource Type | badge (color-coded by group) |
| Model | `resourceSubtype` |
| Provider Cost | `providerCostUsd` (USD) + `providerCostEur` (EUR) |
| Infra | `infraCostEur` |
| Markup | `platformMarkupEur` |
| **Total** | `totalEur` (bold) |
| Tokens | `units.totalTokens` |
| Status | `settled` / `voided` badge |

- Sortable on all numeric columns
- Row click → **Transaction Detail drawer** (all fields including `meta`, `ratesSnapshot`, `sourceRef`)
- **Export CSV:** button triggers `GET /v1/admin/cost/transactions?...&format=csv` (§6.2)

#### 4.9.3 Pagination

Standard offset pagination.  Page size: 25 / 50 / 100. Total row count shown.

---

### 4.10 Correlations Tab

**Purpose:** Explore statistical relationships between cost dimensions.  Answers "Why is cost high?" and "What drives cost?"

#### 4.10.1 Available Chart Panels

Each panel is independently configurable.  The tab renders a 2×2 grid of panels by default; panels can be maximised.

##### Panel A — Cost vs Token Volume Scatter

- X axis: `totalTokens` (log scale)
- Y axis: `totalEur`
- Color: by `resourceType` group
- Shape: by provider
- Each point = one transaction (sampled to max 5 000 points for performance)
- **Purpose:** confirm token-cost linearity; detect outliers (high cost / low tokens = fixed fee dominance; low cost / high tokens = very cheap model)

##### Panel B — Provider Cost vs Platform Revenue Scatter

- X axis: `providerCostEur`
- Y axis: `totalEur`
- Color: by provider
- **Ideal line:** y = x + fixed margin
- **Purpose:** visualise gross margin consistency across transaction volume

##### Panel C — Daily Cost Heatmap

- X axis: hour of day (0–23)
- Y axis: day of week (Mon–Sun)
- Color intensity: `totalEur`
- **Purpose:** identify peak usage hours → capacity planning and spot-pricing signals

##### Panel D — Cost Share Shift Over Time (100% stacked area)

- Stacks: provider share of total (SiliconFlow %, OpenRouter %, Internal %)
- X axis: date
- **Purpose:** detect provider dependency drift — are we becoming more reliant on one provider?

#### 4.10.2 Correlation Insights Panel

A text-format summary (computed server-side, see §6.2) with automatically generated observations:

```
• Top 3 users account for 68% of total cost in this period (high concentration).
• OpenRouter transactions average 2.4× the cost of SiliconFlow for similar token counts.
• image.gen costs increased 42% week-over-week; primary driver: Project "Brand Refresh 2026".
• Estimate accuracy for SiliconFlow: R² = 0.91 (good fit).
• Estimate accuracy for OpenRouter: R² = 0.99 (provider cost passthrough working correctly).
```

Rules for auto-generated insights (v1 — heuristic only, no ML):
- Concentration: flag if top 3 users > 60% of total
- Provider cost ratio: compute mean `totalEur/providerCostEur` per provider, flag if > 2× difference
- Week-over-week change: flag any resource type group with > 30% WoW change
- Estimate accuracy: compute R² between `providerCostUsd_estimated` and `providerCostUsd_actual` per provider

---

## 5. API Endpoints — New Requirements

### 5.1 User-facing Endpoints

#### `GET /v1/users/me/cost`

**Existing.** Extend the response to support:
- `?days=7|30|90|all` — period filter for all metrics
- `trend` array length matches the requested period (not hardcoded 30)

**Extend `UserCostSummaryDto`:**

```typescript
export interface UserCostSummaryDto {
    summary: CostSummaryDto;
    breakdown: CostTypeBreakdownDto[];
    trend: CostTrendPointDto[];
    topProjects: Array<{
        projectId: string;
        projectName?: string;       // NEW — resolved name
        totalEur: number;
        txCount: number;            // NEW
        lastActivityAt?: string;    // NEW
    }>;
    topModels: Array<{             // NEW
        model: string;             // resourceSubtype
        provider?: string;         // from meta.provider
        totalEur: number;
        totalTokens: number;
        txCount: number;
        tokenEfficiencyEurPer1k: number;
    }>;
}
```

#### `GET /v1/users/me/cost/transactions`

**New endpoint.** Paginated transaction list scoped to the authenticated user.

Query params: `page`, `limit`, `from`, `to`, `resourceType`, `projectId`, `status`.  
Response: `PagedCostTransactionsDto` (already defined in contracts).

---

### 5.2 Admin Analytics Endpoints

All under `/v1/admin/cost/analytics/` — `requireSuperAdmin` middleware.

#### `GET /v1/admin/cost/analytics/summary`

KPI summary with delta vs prior period.

Query params: `from`, `to`, `userId`, `projectId`, `resourceType`, `provider`.

```typescript
interface AdminCostAnalyticsSummaryDto {
    current: CostSummaryDto & { activeUsers: number; grossMarginPct: number };
    prior: CostSummaryDto & { activeUsers: number; grossMarginPct: number };
    deltaEurPct: number;          // % change in totalEur
    deltaUsersPct: number;
    deltaMarginPct: number;
}
```

#### `GET /v1/admin/cost/analytics/trend`

Multi-series trend data for Overview tab.

Query params: `from`, `to`, `granularity=day|week|month` (auto if omitted based on range).

```typescript
interface AdminCostTrendSeriesDto {
    series: Array<{
        date: string;
        totalEur: number;
        providerCostEur: number;
        infraCostEur: number;
        platformMarkupEur: number;
        txCount: number;
    }>;
}
```

#### `GET /v1/admin/cost/analytics/trend-by-group`

Same as above but broken down by `ResourceType` group (LLM, Image, Video, Compute, Platform).

```typescript
interface AdminCostTrendByGroupDto {
    series: Array<{
        date: string;
        groups: Record<string, number>;   // groupKey → totalEur
    }>;
}
```

#### `GET /v1/admin/cost/analytics/by-provider`

Provider-level breakdown.

Query params: same global filters.

```typescript
interface AdminCostByProviderDto {
    items: Array<{
        provider: string;
        totalEur: number;
        providerCostEur: number;
        grossMarginPct: number;
        txCount: number;
        totalTokens: number;
        tokenEfficiencyEurPer1k: number;
        avgCostPerCall: number;
    }>;
}
```

**Note:** Provider is derived from `meta.provider`.  Transactions without `meta.provider` are grouped under `"internal"`.

#### `GET /v1/admin/cost/analytics/by-model`

Model-level breakdown.

Same DTO shape as `by-provider` but keyed on `resourceSubtype`.  Adds `promptTokens`, `completionTokens`, `avgLatencyMs`.

#### `GET /v1/admin/cost/analytics/by-user`

User-level breakdown.

```typescript
interface AdminCostByUserDto {
    items: Array<{
        userId: string;
        email: string;
        plan: string;
        totalEur: number;
        providerCostEur: number;
        txCount: number;
        avgPerTx: number;
        primaryResourceType: string;
        lastActivityAt: string;
        anomalyFlags: Array<"spike" | "new_high" | "dormant_active">;
    }>;
    concentrationTop3Pct: number;
    concentrationTop10Pct: number;
}
```

#### `GET /v1/admin/cost/analytics/by-project`

Project-level breakdown.

```typescript
interface AdminCostByProjectDto {
    items: Array<{
        projectId: string;
        projectName: string;
        ownerEmail: string;
        totalEur: number;
        providerCostEur: number;
        txCount: number;
        costVelocityEurPerDay: number;
        primaryResourceType: string;
        lastActivityAt: string;
    }>;
}
```

#### `GET /v1/admin/cost/analytics/estimate-accuracy`

Provider cost vs estimate comparison.

```typescript
interface AdminCostEstimateAccuracyDto {
    byProvider: Array<{
        provider: string;
        txCount: number;
        rSquared: number;           // 0..1
        meanAbsErrEur: number;
        samples: Array<{            // max 500 for scatter plot
            estimated: number;
            actual: number;
            resourceType: string;
            model: string;
        }>;
    }>;
}
```

**Formula for `estimated`:** reconstruct what the system would have calculated using the `ratesSnapshot` embedded in the transaction, ignoring the provider-reported `providerCostUsd`.

#### `GET /v1/admin/cost/analytics/correlations`

Heatmap, scatter, and insight data.

```typescript
interface AdminCostCorrelationsDto {
    hourlyHeatmap: Array<{           // 7 × 24 grid
        dayOfWeek: number;           // 0=Mon … 6=Sun
        hour: number;
        totalEur: number;
    }>;
    providerShareOverTime: Array<{
        date: string;
        shares: Record<string, number>;   // provider → % of that day's totalEur
    }>;
    insights: string[];              // auto-generated text bullets (§4.10.2)
}
```

#### `GET /v1/admin/cost/transactions` (extend existing)

Add `format=csv` query param.  When set, response is `Content-Type: text/csv` with headers matching the Ledger table columns (§4.9.2).  All other filters apply identically.  Max rows: 10 000.

---

## 6. MongoDB Aggregation Queries (Reference)

These are reference designs for the MongoDB aggregation pipelines backing the new endpoints.  They are not normative — the implementation may optimize or combine pipelines as needed.

### 6.1 User Top Models

```javascript
db.cost_transactions.aggregate([
  { $match: { userId, status: "settled", createdAt: { $gte: from, $lte: to } } },
  { $group: {
      _id: "$resourceSubtype",
      totalEur: { $sum: "$totalEur" },
      txCount: { $sum: 1 },
      totalTokens: { $sum: "$units.totalTokens" },
      provider: { $first: "$meta.provider" }
  }},
  { $addFields: {
      tokenEfficiencyEurPer1k: {
          $cond: [
              { $gt: ["$totalTokens", 0] },
              { $multiply: [{ $divide: ["$totalEur", "$totalTokens"] }, 1000] },
              null
          ]
      }
  }},
  { $sort: { totalEur: -1 } },
  { $limit: 10 }
])
```

### 6.2 Pareto Concentration

```javascript
db.cost_transactions.aggregate([
  { $match: { status: "settled", createdAt: { $gte: from, $lte: to } } },
  { $group: { _id: "$userId", totalEur: { $sum: "$totalEur" } } },
  { $sort: { totalEur: -1 } },
  // Compute running total / grand total client-side from the sorted result
])
```

### 6.3 Hourly Heatmap

```javascript
db.cost_transactions.aggregate([
  { $match: { status: "settled", createdAt: { $gte: from, $lte: to } } },
  { $addFields: {
      dayOfWeek: { $subtract: [{ $dayOfWeek: "$createdAt" }, 2] },  // 0=Mon
      hour: { $hour: "$createdAt" }
  }},
  { $group: {
      _id: { dow: "$dayOfWeek", hour: "$hour" },
      totalEur: { $sum: "$totalEur" }
  }},
  { $project: { dayOfWeek: "$_id.dow", hour: "$_id.hour", totalEur: 1, _id: 0 } }
])
```

### 6.4 Estimate Accuracy (R²)

For each provider: pull all transactions where `meta.provider` matches and `providerCostUsd > 0`.  
For each transaction, compute `estimated = units.totalTokens * ratesSnapshot.textEurPer1kTokens / 1000 / ratesSnapshot.usdToEurRate` (approximation).  
Compute R² between `[estimated]` and `[providerCostEur]` arrays client-side or in the use-case layer.

---

## 7. Frontend Component Inventory

All components are new unless marked "(extend)".

### 7.1 Shared

| Component | Type | Notes |
|---|---|---|
| `CostKpiCard` | shadcn `Card` wrapper | value, sub-line, sparkline, delta badge |
| `SpendTrendChart` | `recharts` `AreaChart` or `LineChart` | reusable, takes series + config |
| `CostTypeDonut` | `recharts` `PieChart` | fixed color map per group |
| `CostTable` | shadcn `Table` | sortable, click-to-detail |
| `TransactionDetailDrawer` | shadcn `Dialog` | all fields, monospace meta dump |
| `CostPeriodPicker` | shadcn `DropdownMenu` | presets + custom date range |
| `ProviderBadge` | custom `Badge` | color-coded per provider |
| `ResourceTypeBadge` | custom `Badge` | color-coded per group |

### 7.2 User Usage Dashboard (`/dashboard/usage`)

| Component | Description |
|---|---|
| `UsageDashboardPage` | page root, owns period state |
| `UserKpiRow` | 3-card KPI row |
| `UserSpendTrendSection` | area chart wrapper |
| `UserProjectsTable` | top projects with cost share bar |
| `UserResourceTypeDonut` | donut + legend |
| `UserTopModelsChart` | horizontal bar chart |
| `UserRecentTransactions` | compact table + "View all" link |
| `UserTransactionsPage` | `/dashboard/usage/transactions` full paginated ledger |

### 7.3 Admin Cost Intelligence (`/admin/cost`)

| Component | Description |
|---|---|
| `CostIntelligencePage` | page root, owns global filter state |
| `GlobalFilterBar` | date range + 5 multi-select dropdowns |
| `CostTabOverview` | Overview tab (§4.4) |
| `CostTabByProvider` | By Provider tab (§4.5) |
| `CostTabByModel` | By Model tab (§4.6) |
| `CostTabByUser` | By User tab (§4.7) |
| `UserCostDetailPanel` | side panel (§4.7.3) |
| `CostTabByProject` | By Project tab (§4.8) |
| `ProjectCostDetailPanel` | side panel (§4.8.4) |
| `CostTabLedger` | Ledger tab (§4.9) |
| `CostTabCorrelations` | Correlations tab (§4.10) |
| `CorrelationInsightsBox` | auto-generated text bullets |

---

## 8. Charting Library Guidance

**Recommended:** `recharts` (already likely present or easy to add as a pure-React library).

Alternatives:
- `visx` — lower-level D3 bindings, better for custom scatter/heatmap
- `Chart.js` via `react-chartjs-2` — larger but well-documented

**Install (if not already):**

```bash
npm install recharts -w apps/web
```

All charts must:
1. Use semantic color tokens from `tailwind.config.ts` (`bg-card`, `text-foreground`, etc.) — never hardcode hex.
2. Be responsive (use `ResponsiveContainer` from recharts).
3. Degrade gracefully when data is empty — show a centered "No data for this period" message.
4. Not block the page render — load data asynchronously with a skeleton placeholder (use `animate-pulse` Tailwind class on placeholder).

---

## 9. Security & Data Isolation

| Requirement | Enforcement |
|---|---|
| User sees only their own data | `GET /v1/users/me/cost` is scoped to `req.auth.userId` — never accept a userId parameter |
| Admin sees all data | `requireSuperAdmin` on all `/v1/admin/cost/analytics/*` routes |
| No PII in export CSV | CSV export omits `meta` blob; user identity columns show email only |
| Rate-limit analytics endpoints | 60 req/min per user on user endpoints; 120 req/min per superadmin on admin endpoints |
| Estimate accuracy samples | the `samples` array in `AdminCostEstimateAccuracyDto` is capped at 500 rows and contains no userId/projectId — use `txId` only |

---

## 10. Implementation Phasing

### Phase 1 — User Usage Tab (MVP)

1. Extend `GET /v1/users/me/cost` to accept `?days=` and return `topModels`.
2. Add `GET /v1/users/me/cost/transactions`.
3. Build `UsageDashboardPage` with KPI row, trend chart, projects table, donut.
4. Add "Usage" nav item in user sidebar.
5. (Optional but high value) Add Top Models bar chart.

**Branch:** `feat/user-usage-dashboard`

### Phase 2 — Admin Overview + Ledger

1. Add `GET /v1/admin/cost/analytics/summary` and `GET /v1/admin/cost/analytics/trend`.
2. Add `/admin/cost` route with GlobalFilterBar skeleton.
3. Build Overview tab (KPIs + trend chart + quick lists).
4. Expose existing Ledger tab (reuse `GET /v1/admin/cost/transactions`).

**Branch:** `feat/admin-cost-overview`

### Phase 3 — Admin Dimension Tabs

1. Add `by-provider`, `by-model`, `by-user`, `by-project` endpoints and corresponding tabs.
2. Add User and Project detail side panels.
3. Add anomaly flag logic in `by-user` endpoint.

**Branch:** `feat/admin-cost-dimensions`

### Phase 4 — Correlations + Estimate Accuracy

1. Add `correlations` and `estimate-accuracy` endpoints.
2. Build Correlations tab with 4-panel grid.
3. Add auto-insight generation in use-case layer.
4. Add CSV export to Ledger tab.

**Branch:** `feat/admin-cost-correlations`

---

## 11. Open Questions

| # | Question | Resolution path |
|---|---|---|
| 1 | Is `meta.provider` consistently populated for all LLM transactions? | Audit `CostTransactionService` call sites; add `provider` to `RecordCostInput` if missing |
| 2 | Should the User Usage tab show project names or only IDs? | Requires a project name resolution call; fetch from `/v1/projects` client-side and hydrate |
| 3 | What is the right CSV export limit? 10 000 rows may be large. | Start with 10 000; add streaming export in v2 if operators need full dumps |
| 4 | Should the R² for SiliconFlow be computed for all resource types or only `llm.*`? | Only `llm.*` for now — image cost from SiliconFlow is per-image not per-token, so the estimate model is different |
| 5 | Should `useProviderCost: false` in `ResourceTypeCostPolicy` affect the estimate-accuracy scatter? | Yes — transactions where `useProviderCost = false` should be excluded from the "provider accuracy" analysis |
| 6 | Charting library: is `recharts` already in the project? | Check `apps/web/package.json` before installing |
| 7 | Do superadmins need email notifications for anomaly flags (§4.7.4)? | Out of scope for this spec; addressed in a future alerting spec |

---

## 12. Related Specifications

| Spec | Relation |
|---|---|
| `COST_TRANSACTION_LEDGER_SPEC.md` | Ledger schema, `ResourceType` enum, rate resolution — this spec reads from it |
| `SUPER_ADMIN_SPEC.md` | Admin role, middleware, nav structure — admin cost tab extends the existing admin shell |
| `MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md` | Provider identity and model naming conventions used in `meta.provider` and `resourceSubtype` |
| `SPEC.md` | Overall platform spec; cost analytics surfaces the platform economics |
