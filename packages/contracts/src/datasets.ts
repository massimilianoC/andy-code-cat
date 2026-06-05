import { z } from "zod";

export const datasetColumnTypeSchema = z.enum(["string", "number", "boolean", "date", "unknown"]);
export type DatasetColumnType = z.infer<typeof datasetColumnTypeSchema>;

export interface DatasetColumnProfileDto {
    key: string;
    label: string;
    valueType: DatasetColumnType;
    nonNullCount: number;
    nullCount: number;
    nullRatio: number;
    distinctCount: number;
    sampleValues: string[];
    min?: number | string | null;
    max?: number | string | null;
    mean?: number | null;
    sum?: number | null;
}

export interface DatasetTableProfileDto {
    name: string;
    sourceFormat: "csv" | "xlsx" | "json" | "xml" | "sql";
    rowCount: number;
    columnCount: number;
    columns: DatasetColumnProfileDto[];
    sampleHeaders: string[];
    sampleRows: string[][];
    notes?: string[];
}

export interface DatasetFactsEnvelopeDto {
    rowCount: number;
    columnCount: number;
    numericColumnCount: number;
    categoricalColumnCount: number;
    booleanColumnCount: number;
    dateColumnCount: number;
    supportedAggregations: Array<"count" | "sum" | "avg" | "min" | "max" | "distinct_count" | "top_values">;
}

export interface DatasetProfileDto {
    assetId: string;
    projectId: string;
    originalName: string;
    mimeType: string;
    tables: DatasetTableProfileDto[];
    facts: DatasetFactsEnvelopeDto;
    limitations: string[];
    grounded: true;
}

export interface ProjectDatasetListItemDto {
    id: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
    createdAt: string;
    profileReady: boolean;
    cacheReady: boolean;
}

export interface ProjectDatasetListResponseDto {
    datasets: ProjectDatasetListItemDto[];
}

export const datasetFilterSchema = z.object({
    column: z.string().min(1).max(120),
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"]),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()]))]),
});

export const datasetSortSchema = z.object({
    column: z.string().min(1).max(120),
    direction: z.enum(["asc", "desc"]).default("asc"),
});

export const datasetQuerySchema = z.object({
    tableName: z.string().min(1).max(120).optional(),
    aggregation: z.enum(["count", "sum", "avg", "min", "max", "distinct_count", "top_values"]),
    column: z.string().min(1).max(120).optional(),
    groupBy: z.string().min(1).max(120).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    filters: z.array(datasetFilterSchema).max(10).optional(),
});

export type DatasetQueryInput = z.infer<typeof datasetQuerySchema>;

export interface DatasetQueryFactDto {
    label: string;
    value: string | number | boolean | null;
}

export interface DatasetQueryResponseDto {
    grounded: true;
    tableName: string;
    aggregation: DatasetQueryInput["aggregation"];
    column?: string;
    groupBy?: string;
    filters: Array<z.infer<typeof datasetFilterSchema>>;
    rowCountBeforeFilters: number;
    rowCountAfterFilters: number;
    result:
        | number
        | string
        | null
        | Array<{
            key: string;
            value: number;
        }>;
    facts: DatasetQueryFactDto[];
}

export const datasetAskSchema = z.object({
    question: z.string().min(1).max(500),
    tableName: z.string().min(1).max(120).optional(),
});

export type DatasetAskInput = z.infer<typeof datasetAskSchema>;

export const datasetBrowseSchema = z.object({
    tableName: z.string().min(1).max(120).optional(),
    offset: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(100).default(25),
    filters: z.array(datasetFilterSchema).max(10).optional(),
    sort: datasetSortSchema.optional(),
});

export type DatasetBrowseInput = z.infer<typeof datasetBrowseSchema>;

export interface DatasetAskResponseDto {
    grounded: true;
    supported: boolean;
    question: string;
    interpretation: string;
    answer: string;
    query?: DatasetQueryResponseDto;
    refusalReason?: string;
}

export interface DatasetInsightDto {
    id: string;
    title: string;
    summary: string;
    severity: "info" | "highlight";
    facts: DatasetQueryFactDto[];
}

export interface DatasetInsightsResponseDto {
    grounded: true;
    insights: DatasetInsightDto[];
}

export interface DatasetDashboardChartSuggestionDto {
    id: string;
    title: string;
    chartType: "kpi" | "bar" | "line" | "table";
    rationale: string;
    query: DatasetQueryInput;
}

export interface DatasetDashboardSuggestionResponseDto {
    grounded: true;
    sections: Array<{
        id: string;
        title: string;
        description: string;
        charts: DatasetDashboardChartSuggestionDto[];
    }>;
}

export interface DatasetBrowseResponseDto {
    grounded: true;
    tableName: string;
    columns: string[];
    offset: number;
    limit: number;
    totalRows: number;
    totalRowsAfterFilters: number;
    filters: Array<z.infer<typeof datasetFilterSchema>>;
    sort?: z.infer<typeof datasetSortSchema>;
    rows: Array<Record<string, string | number | boolean | null>>;
}
