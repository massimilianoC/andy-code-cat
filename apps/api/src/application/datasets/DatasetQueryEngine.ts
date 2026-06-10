import type { DatasetAskResponseDto, DatasetBrowseInput, DatasetBrowseResponseDto, DatasetInsightsResponseDto, DatasetDashboardSuggestionResponseDto, DatasetQueryInput, DatasetQueryResponseDto } from "@andy-code-cat/contracts";
import type { DatasetColumnProfile, DatasetTableProfile } from "../../domain/entities/AssetEnrichmentTrace";
import type { DatasetPrimitive, DatasetRow, NormalizedDataset, NormalizedDatasetTable } from "./DatasetRuntime";

type FilterDto = DatasetQueryResponseDto["filters"][number];
type SortDto = NonNullable<DatasetBrowseResponseDto["sort"]>;

function getTable(dataset: NormalizedDataset, tableName?: string): NormalizedDatasetTable {
    if (tableName) {
        const match = dataset.tables.find((table) => table.name === tableName);
        if (!match) throw new Error(`Unknown table "${tableName}"`);
        return match;
    }
    const [first] = dataset.tables;
    if (!first) throw new Error("Dataset has no tables");
    return first;
}

function getColumn(table: DatasetTableProfile, columnName: string): DatasetColumnProfile {
    const match = table.columns.find((column) => column.key === columnName);
    if (!match) throw new Error(`Unknown column "${columnName}" on table "${table.name}"`);
    return match;
}

function coerceForComparison(value: DatasetPrimitive): string | number | boolean | null {
    return value;
}

function applyFilters(rows: DatasetRow[], filters: FilterDto[] | undefined): DatasetRow[] {
    if (!filters || filters.length === 0) return rows;
    return rows.filter((row) => {
        return filters.every((filter) => {
            const current = coerceForComparison(row[filter.column] ?? null);
            switch (filter.operator) {
                case "eq":
                    return current === filter.value;
                case "neq":
                    return current !== filter.value;
                case "contains":
                    return String(current ?? "").toLowerCase().includes(String(filter.value).toLowerCase());
                case "in":
                    return Array.isArray(filter.value) && filter.value.map(String).includes(String(current));
                case "gt":
                    return typeof current === "number" && typeof filter.value === "number" && current > filter.value;
                case "gte":
                    return typeof current === "number" && typeof filter.value === "number" && current >= filter.value;
                case "lt":
                    return typeof current === "number" && typeof filter.value === "number" && current < filter.value;
                case "lte":
                    return typeof current === "number" && typeof filter.value === "number" && current <= filter.value;
                default:
                    return false;
            }
        });
    });
}

function compareDatasetValues(left: DatasetPrimitive, right: DatasetPrimitive): number {
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    if (typeof left === "number" && typeof right === "number") return left - right;
    if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
    return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function applySort(rows: DatasetRow[], sort: SortDto | undefined): DatasetRow[] {
    if (!sort) return rows;
    const directionMultiplier = sort.direction === "desc" ? -1 : 1;
    return [...rows].sort((left, right) => compareDatasetValues(left[sort.column] ?? null, right[sort.column] ?? null) * directionMultiplier);
}

export function browseDatasetRows(dataset: NormalizedDataset, input: DatasetBrowseInput): DatasetBrowseResponseDto {
    const table = getTable(dataset, input.tableName);
    const filteredRows = applySort(applyFilters(table.rows, input.filters), input.sort);
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 25;
    const rows = filteredRows.slice(offset, offset + limit).map((row) => {
        const normalized: Record<string, string | number | boolean | null> = {};
        for (const column of table.profile.columns) {
            normalized[column.key] = row[column.key] ?? null;
        }
        return normalized;
    });

    return {
        grounded: true,
        tableName: table.name,
        columns: table.profile.columns.map((column) => column.key),
        offset,
        limit,
        totalRows: table.rows.length,
        totalRowsAfterFilters: filteredRows.length,
        filters: input.filters ?? [],
        sort: input.sort,
        rows,
    };
}

function numberValues(rows: DatasetRow[], columnName: string): number[] {
    return rows.map((row) => row[columnName]).filter((value): value is number => typeof value === "number");
}

export function executeDatasetQuery(dataset: NormalizedDataset, input: DatasetQueryInput): DatasetQueryResponseDto {
    const table = getTable(dataset, input.tableName);
    const rowsBefore = table.rows.length;
    const filteredRows = applyFilters(table.rows, input.filters);
    const limit = input.limit ?? 10;
    const facts: DatasetQueryResponseDto["facts"] = [
        { label: "table", value: table.name },
        { label: "rows_before_filters", value: rowsBefore },
        { label: "rows_after_filters", value: filteredRows.length },
    ];

    let result: DatasetQueryResponseDto["result"] = null;

    if (input.aggregation === "count") {
        result = filteredRows.length;
    } else if (input.aggregation === "distinct_count") {
        if (!input.column) throw new Error("column is required for distinct_count");
        const columnName = input.column;
        getColumn(table.profile, columnName);
        result = new Set(filteredRows.map((row) => String(row[columnName] ?? "null"))).size;
    } else if (input.aggregation === "top_values") {
        if (!input.column) throw new Error("column is required for top_values");
        const columnName = input.column;
        getColumn(table.profile, columnName);
        const frequency = new Map<string, number>();
        for (const row of filteredRows) {
            const key = String(row[columnName] ?? "null");
            frequency.set(key, (frequency.get(key) ?? 0) + 1);
        }
        result = [...frequency.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([key, value]) => ({ key, value }));
    } else {
        if (!input.column) throw new Error("column is required for numeric aggregations");
        const column = getColumn(table.profile, input.column);
        const values = numberValues(filteredRows, input.column);
        if (column.valueType !== "number") {
            throw new Error(`Column "${input.column}" is not numeric`);
        }
        if (input.aggregation === "sum") result = Number(values.reduce((acc, value) => acc + value, 0).toFixed(4));
        if (input.aggregation === "avg") result = values.length > 0 ? Number((values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(4)) : null;
        if (input.aggregation === "min") result = values.length > 0 ? Math.min(...values) : null;
        if (input.aggregation === "max") result = values.length > 0 ? Math.max(...values) : null;
    }

    if (input.groupBy && Array.isArray(result) === false && input.aggregation !== "top_values") {
        const grouped = new Map<string, DatasetRow[]>();
        getColumn(table.profile, input.groupBy);
        for (const row of filteredRows) {
            const key = String(row[input.groupBy] ?? "null");
            const bucket = grouped.get(key) ?? [];
            bucket.push(row);
            grouped.set(key, bucket);
        }
        result = [...grouped.entries()]
            .map(([key, bucket]) => {
                if (input.aggregation === "count") {
                    return { key, value: bucket.length };
                }
                if (!input.column) {
                    throw new Error("column is required when grouping numeric aggregations");
                }
                const values = numberValues(bucket, input.column);
                let value = 0;
                if (input.aggregation === "sum") value = values.reduce((acc, current) => acc + current, 0);
                if (input.aggregation === "avg") value = values.length > 0 ? values.reduce((acc, current) => acc + current, 0) / values.length : 0;
                if (input.aggregation === "min") value = values.length > 0 ? Math.min(...values) : 0;
                if (input.aggregation === "max") value = values.length > 0 ? Math.max(...values) : 0;
                return { key, value: Number(value.toFixed(4)) };
            })
            .sort((a, b) => b.value - a.value)
            .slice(0, limit);
    }

    if (input.column) facts.push({ label: "column", value: input.column });
    if (input.groupBy) facts.push({ label: "group_by", value: input.groupBy });
    facts.push({ label: "aggregation", value: input.aggregation });

    return {
        grounded: true,
        tableName: table.name,
        aggregation: input.aggregation,
        column: input.column,
        groupBy: input.groupBy,
        filters: input.filters ?? [],
        rowCountBeforeFilters: rowsBefore,
        rowCountAfterFilters: filteredRows.length,
        result,
        facts,
    };
}

function findColumnByQuestion(table: DatasetTableProfile, question: string, numericOnly = false): string | undefined {
    const lowered = question.toLowerCase();
    return table.columns.find((column) => {
        if (numericOnly && column.valueType !== "number") return false;
        return lowered.includes(column.key.toLowerCase());
    })?.key;
}

export function answerDatasetQuestion(dataset: NormalizedDataset, question: string, tableName?: string): DatasetAskResponseDto {
    const table = getTable(dataset, tableName);
    const lowered = question.toLowerCase();

    try {
        if (/(how many|quanti|count|numero)/.test(lowered) && /(rows|record|righe|records)/.test(lowered)) {
            const query = executeDatasetQuery(dataset, { tableName: table.name, aggregation: "count" });
            return {
                grounded: true,
                supported: true,
                question,
                interpretation: "Count rows in the selected table.",
                answer: `The table "${table.name}" contains ${query.result} rows.`,
                query,
            };
        }

        const numericColumn = findColumnByQuestion(table.profile, lowered, true);
        if (numericColumn && /(sum|totale|total)/.test(lowered)) {
            const query = executeDatasetQuery(dataset, { tableName: table.name, aggregation: "sum", column: numericColumn });
            return {
                grounded: true,
                supported: true,
                question,
                interpretation: `Compute the sum of column "${numericColumn}".`,
                answer: `The sum of "${numericColumn}" is ${query.result}.`,
                query,
            };
        }
        if (numericColumn && /(average|avg|media|mean)/.test(lowered)) {
            const query = executeDatasetQuery(dataset, { tableName: table.name, aggregation: "avg", column: numericColumn });
            return {
                grounded: true,
                supported: true,
                question,
                interpretation: `Compute the average of column "${numericColumn}".`,
                answer: `The average of "${numericColumn}" is ${query.result}.`,
                query,
            };
        }

        const anyColumn = findColumnByQuestion(table.profile, lowered, false);
        if (anyColumn && /(top|most common|piu comune|frequent)/.test(lowered)) {
            const query = executeDatasetQuery(dataset, { tableName: table.name, aggregation: "top_values", column: anyColumn, limit: 5 });
            return {
                grounded: true,
                supported: true,
                question,
                interpretation: `List the most frequent values of column "${anyColumn}".`,
                answer: `The most frequent values of "${anyColumn}" are derived directly from the dataset.`,
                query,
            };
        }
    } catch (error) {
        return {
            grounded: true,
            supported: false,
            question,
            interpretation: "The question maps to a supported deterministic query, but execution failed.",
            answer: "I could not compute a reliable grounded answer.",
            refusalReason: error instanceof Error ? error.message : "Unsupported question",
        };
    }

    return {
        grounded: true,
        supported: false,
        question,
        interpretation: "Only deterministic supported query patterns are allowed in this runtime.",
        answer: "Unsupported question. Try asking for row count, sum, average, or top values of a named column.",
        refusalReason: "The question cannot be translated into a supported deterministic query.",
    };
}

export function buildDatasetInsights(dataset: NormalizedDataset, tableName?: string): DatasetInsightsResponseDto {
    const insights: DatasetInsightsResponseDto["insights"] = [];
    const table = getTable(dataset, tableName);
    if (!table) return { grounded: true, insights };

    insights.push({
        id: "rows-columns",
        title: "Dataset shape",
        summary: `The selected table has ${table.profile.rowCount} rows and ${table.profile.columnCount} columns.`,
        severity: "info",
        facts: [
            { label: "table", value: table.name },
            { label: "rows", value: table.profile.rowCount },
            { label: "columns", value: table.profile.columnCount },
        ],
    });

    const sparse = [...table.profile.columns].sort((a, b) => b.nullRatio - a.nullRatio)[0];
    if (sparse && sparse.nullRatio > 0) {
        insights.push({
            id: "null-ratio",
            title: "Sparsest column",
            summary: `Column "${sparse.key}" has the highest null ratio in the selected table.`,
            severity: "highlight",
            facts: [
                { label: "column", value: sparse.key },
                { label: "null_ratio", value: sparse.nullRatio },
                { label: "null_count", value: sparse.nullCount },
            ],
        });
    }

    const numeric = table.profile.columns.find((column) => column.valueType === "number" && typeof column.sum === "number");
    if (numeric) {
        insights.push({
            id: `numeric-${numeric.key}`,
            title: `Numeric span: ${numeric.key}`,
            summary: `Column "${numeric.key}" supports deterministic KPI extraction with min, max, average, and sum already profiled.`,
            severity: "info",
            facts: [
                { label: "min", value: numeric.min ?? null },
                { label: "max", value: numeric.max ?? null },
                { label: "mean", value: numeric.mean ?? null },
                { label: "sum", value: numeric.sum ?? null },
            ],
        });
    }

    return { grounded: true, insights };
}

export function buildDashboardSuggestion(dataset: NormalizedDataset, tableName?: string): DatasetDashboardSuggestionResponseDto {
    const table = getTable(dataset, tableName);
    if (!table) return { grounded: true, sections: [] };

    const numericColumn = table.profile.columns.find((column) => column.valueType === "number");
    const categoryColumn = table.profile.columns.find((column) => column.valueType === "string" && column.distinctCount > 1 && column.distinctCount <= 25);
    const dateColumn = table.profile.columns.find((column) => column.valueType === "date");

    const sections: DatasetDashboardSuggestionResponseDto["sections"] = [
        {
            id: "overview",
            title: "Overview",
            description: "Fast grounded KPIs from deterministic dataset facts.",
            charts: [
                {
                    id: "row-count",
                    title: "Total rows",
                    chartType: "kpi",
                    rationale: "Useful as a primary completeness signal for the dataset.",
                    query: { tableName: table.name, aggregation: "count" },
                },
                ...(numericColumn ? [{
                    id: `sum-${numericColumn.key}`,
                    title: `Total ${numericColumn.label}`,
                    chartType: "kpi" as const,
                    rationale: "The first numeric column is a natural KPI candidate.",
                    query: { tableName: table.name, aggregation: "sum" as const, column: numericColumn.key },
                }] : []),
            ],
        },
    ];

    if (categoryColumn) {
        sections.push({
            id: "distribution",
            title: "Distribution",
            description: "Category breakdown over the most interpretable categorical dimension.",
            charts: [
                {
                    id: `top-${categoryColumn.key}`,
                    title: `Top ${categoryColumn.label}`,
                    chartType: "bar",
                    rationale: "A categorical column with bounded cardinality can drive a ranked distribution chart.",
                    query: {
                        tableName: table.name,
                        aggregation: numericColumn ? "sum" : "count",
                        column: numericColumn?.key,
                        groupBy: categoryColumn.key,
                        limit: 8,
                    },
                },
            ],
        });
    }

    if (dateColumn && numericColumn) {
        sections.push({
            id: "trend",
            title: "Trend",
            description: "Time-based trend suggestion when date and numeric dimensions coexist.",
            charts: [
                {
                    id: `trend-${numericColumn.key}`,
                    title: `${numericColumn.label} over ${dateColumn.label}`,
                    chartType: "line",
                    rationale: "Date + numeric is the minimum viable pair for a trend chart.",
                    query: {
                        tableName: table.name,
                        aggregation: "sum",
                        column: numericColumn.key,
                        groupBy: dateColumn.key,
                        limit: 12,
                    },
                },
            ],
        });
    }

    sections.push({
        id: "records",
        title: "Record browser",
        description: "Tabular inspection remains the source-of-truth view for raw rows.",
        charts: [
            {
                id: "records-table",
                title: "Sample rows",
                chartType: "table",
                rationale: "A table preserves the raw context behind KPIs and chart summaries.",
                query: { tableName: table.name, aggregation: "count" },
            },
        ],
    });

    return { grounded: true, sections };
}
