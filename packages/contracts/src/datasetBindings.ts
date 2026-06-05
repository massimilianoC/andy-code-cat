import { z } from "zod";

export const datasetBindingRuntimeModeSchema = z.enum([
    "source_file",
    "normalized_local",
    "backend_query",
    "hybrid",
]);

export const datasetBindingExposureClassSchema = z.enum([
    "private_runtime_only",
    "published_runtime_only",
    "published_runtime_plus_source",
    "backend_only",
]);

export const artifactKindSchema = z.enum(["website", "data_dashboard"]);

export const dashboardDefinitionSchema = z.object({
    title: z.string().max(200).optional(),
    description: z.string().max(1000).optional(),
    defaultBindingId: z.string().max(120).optional(),
    defaultTableName: z.string().max(200).optional(),
    preferredInteractionMode: z.enum(["local_first", "backend_first", "hybrid"]).optional(),
}).strict();

export const dashboardQuerySpecSchema = z.object({
    queryId: z.string().max(120),
    bindingId: z.string().max(120),
    tableName: z.string().max(200).optional(),
    intent: z.enum(["kpi", "series", "distribution", "table", "ranking"]),
    aggregation: z.string().max(80).optional(),
    column: z.string().max(200).optional(),
    groupBy: z.string().max(200).optional(),
    filters: z.array(z.record(z.unknown())).max(25).optional(),
    limit: z.number().int().positive().max(10000).optional(),
}).strict();

export const dashboardChartSpecSchema = z.object({
    chartId: z.string().max(120),
    queryId: z.string().max(120),
    family: z.enum(["line", "bar", "area", "pie", "table", "metric"]),
    title: z.string().max(200),
    x: z.string().max(200).optional(),
    y: z.string().max(200).optional(),
    series: z.string().max(200).optional(),
}).strict();

export const dataDashboardDatasetBindingSchema = z.object({
    bindingId: z.string().max(120),
    assetId: z.string().max(120),
    tableName: z.string().max(200).optional(),
    runtimeMode: datasetBindingRuntimeModeSchema,
    exposureClass: datasetBindingExposureClassSchema,
    limitations: z.array(z.string().max(400)).max(50).default([]),
}).strict();

export const dataDashboardArtifactMetadataSchema = z.object({
    artifactKind: z.literal("data_dashboard"),
    datasetBindings: z.array(dataDashboardDatasetBindingSchema).max(20),
    dashboardDefinition: dashboardDefinitionSchema.optional(),
    querySpecs: z.array(dashboardQuerySpecSchema).max(100).optional(),
    chartSpecs: z.array(dashboardChartSpecSchema).max(100).optional(),
}).strict();

export const publishedDatasetBindingSchema = dataDashboardDatasetBindingSchema.extend({
    originalName: z.string().max(255),
    sourceFormat: z.enum(["csv", "xlsx", "json", "xml", "sql"]),
    publishedRuntimePath: z.string().max(300).optional(),
    publishedSourcePath: z.string().max(300).optional(),
    backendProfileUrl: z.string().max(500).optional(),
    backendQueryUrl: z.string().max(500).optional(),
    backendBrowseUrl: z.string().max(500).optional(),
    backendInsightsUrl: z.string().max(500).optional(),
}).strict();

export const publishedDatasetManifestSchema = z.object({
    version: z.literal("dataset-bindings-v1"),
    publishId: z.string().max(120),
    projectId: z.string().max(120),
    generatedAt: z.string().max(80),
    artifactKind: z.literal("data_dashboard"),
    bindings: z.array(publishedDatasetBindingSchema).max(20),
    dashboardDefinition: dashboardDefinitionSchema.optional(),
    querySpecs: z.array(dashboardQuerySpecSchema).max(100).optional(),
    chartSpecs: z.array(dashboardChartSpecSchema).max(100).optional(),
    limitations: z.array(z.string().max(500)).max(100).default([]),
}).strict();

export type DatasetBindingRuntimeMode = z.infer<typeof datasetBindingRuntimeModeSchema>;
export type DatasetBindingExposureClass = z.infer<typeof datasetBindingExposureClassSchema>;
export type ArtifactKind = z.infer<typeof artifactKindSchema>;
export type DashboardDefinitionDto = z.infer<typeof dashboardDefinitionSchema>;
export type DashboardQuerySpecDto = z.infer<typeof dashboardQuerySpecSchema>;
export type DashboardChartSpecDto = z.infer<typeof dashboardChartSpecSchema>;
export type DataDashboardDatasetBindingDto = z.infer<typeof dataDashboardDatasetBindingSchema>;
export type DataDashboardArtifactMetadataDto = z.infer<typeof dataDashboardArtifactMetadataSchema>;
export type PublishedDatasetBindingDto = z.infer<typeof publishedDatasetBindingSchema>;
export type PublishedDatasetManifestDto = z.infer<typeof publishedDatasetManifestSchema>;
