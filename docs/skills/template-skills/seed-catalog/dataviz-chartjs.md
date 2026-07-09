# dataviz-chartjs

Applies to: `presetIds: data-dashboard, infographic`, `tags: dataviz, chart`

Use this skill when generating chart-based dashboards, infographics, or visual analytics using
Chart.js.

## Chart Selection

- Use bar charts for category comparison.
- Use line charts for trends over ordered time or sequence.
- Use doughnut/pie charts only for small part-to-whole comparisons.
- Use tables or KPI cards when exact values matter more than visual pattern.

## Data Honesty

- Label axes and units.
- Keep scales readable and avoid misleading truncation unless clearly justified.
- Do not invent data when the prompt or dataset does not provide it.
- If data is illustrative, label it as sample or demo data.

## Responsive Rules

- Place each canvas inside a positioned container with stable dimensions.
- Let Chart.js manage render size through responsive options instead of hardcoding canvas `width`/`height` attributes.
- Reflow charts into one column on narrow screens.

## Accessibility

- Add accessible names, ARIA labels, or fallback text for canvas charts.
- Provide a short textual insight beside each chart.
- Use color plus labels/patterns, not color alone.

## Avoid

- Chart-only dashboards with no explanation.
- Tiny legends, illegible axes, or overloaded multi-series charts.
- Decorative charts that do not answer a question.
- Fetching external datasets at runtime unless a future service manifest explicitly provides them.

## Acceptance Checks

- Every chart answers a named question.
- Every chart has labels, units, and a textual takeaway.
- The dashboard is readable at mobile width.
- Canvas content has fallback/accessibility text.

Sources:

- Chart.js accessibility: https://www.chartjs.org/docs/latest/general/accessibility.html
- Chart.js responsive charts: https://www.chartjs.org/docs/latest/configuration/responsive.html
