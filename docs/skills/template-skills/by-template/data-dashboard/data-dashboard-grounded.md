# data-dashboard-grounded

Applies to: `presetIds: data-dashboard`, `tags: dataset, dashboard, kpi, analytics`

Use this skill when generating dashboards or analytics artifacts grounded in uploaded datasets.

## Goal

The artifact must present grounded data clearly and avoid unsupported claims.

## Required Structure

- Dataset summary: source name, row/table count if available, scope and limitations.
- KPI row with 3-5 metrics.
- One or more charts selected for the data type.
- Table or sample rows for verification.
- Insights section that separates observed facts from interpretation.
- Limitations/freshness note.

## Grounding Rules

- Do not invent data.
- Mark sample/demo data clearly if real data is unavailable.
- Prefer backend-provided dataset profile, schema, and deterministic facts.
- Refuse speculative causal claims when the dataset does not support them.

## Chart Rules

- Use charts only when they answer a visible question.
- Label units and axes.
- Provide textual takeaways.
- Preserve raw table values as source of truth.

## Avoid

- Decorative dashboards with fake KPIs.
- Hidden heuristics.
- Unexplained filters or transformations.
- Claims about trends without time/order data.

## Acceptance Checks

- Every KPI has a source or is marked sample.
- Every chart has a question and takeaway.
- Unsupported questions are refused or framed as limitations.
- Raw/sample rows remain inspectable.
