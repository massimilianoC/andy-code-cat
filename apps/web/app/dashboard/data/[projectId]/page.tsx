"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DataDashboardDraft } from "@andy-code-cat/contracts";
import { getToken, hasRole } from "@/lib/token-store";
import {
    askDataset,
    browseDataset,
    type DatasetBrowseResponseDto,
    getDatasetDashboardSuggestion,
    getDatasetInsights,
    getDatasetProfile,
    listProjectDatasets,
    queryDataset,
    type DatasetDashboardSuggestionResponseDto,
    type DatasetInsightsResponseDto,
    type DatasetListItem,
    type DatasetProfileDto,
    type DatasetQueryInput,
    type DatasetQueryResponseDto,
} from "@/lib/api/datasets";
import { uploadProjectAsset } from "@/lib/api/assets";
import { ApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const AGGREGATIONS: DatasetQueryInput["aggregation"][] = ["count", "sum", "avg", "min", "max", "distinct_count", "top_values"];
const FILTER_OPERATORS: NonNullable<DatasetQueryInput["filters"]>[number]["operator"][] = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"];
const DATA_DASHBOARD_PREFILL_KEY_PREFIX = "data_dashboard_prefill_";

export default function ProjectDataDashboardPage() {
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const params = useParams<{ projectId: string }>();
    const projectId = String(params.projectId ?? "");
    const [token, setToken] = useState<string | null>(null);
    const [datasetItems, setDatasetItems] = useState<DatasetListItem[]>([]);
    const [selectedAssetId, setSelectedAssetId] = useState("");
    const [selectedTableName, setSelectedTableName] = useState("");
    const [profile, setProfile] = useState<DatasetProfileDto | null>(null);
    const [insights, setInsights] = useState<DatasetInsightsResponseDto | null>(null);
    const [dashboardSuggestion, setDashboardSuggestion] = useState<DatasetDashboardSuggestionResponseDto | null>(null);
    const [queryResult, setQueryResult] = useState<DatasetQueryResponseDto | null>(null);
    const [browseResult, setBrowseResult] = useState<DatasetBrowseResponseDto | null>(null);
    const [queryAggregation, setQueryAggregation] = useState<DatasetQueryInput["aggregation"]>("count");
    const [queryColumn, setQueryColumn] = useState("");
    const [queryGroupBy, setQueryGroupBy] = useState("");
    const [queryLimit, setQueryLimit] = useState("10");
    const [filterColumn, setFilterColumn] = useState("");
    const [filterOperator, setFilterOperator] = useState<NonNullable<DatasetQueryInput["filters"]>[number]["operator"]>("eq");
    const [filterValue, setFilterValue] = useState("");
    const [filterColumnTwo, setFilterColumnTwo] = useState("");
    const [filterOperatorTwo, setFilterOperatorTwo] = useState<NonNullable<DatasetQueryInput["filters"]>[number]["operator"]>("eq");
    const [filterValueTwo, setFilterValueTwo] = useState("");
    const [browseSortColumn, setBrowseSortColumn] = useState("");
    const [browseSortDirection, setBrowseSortDirection] = useState<"asc" | "desc">("asc");
    const [question, setQuestion] = useState("");
    const [askAnswer, setAskAnswer] = useState("");
    const [browseOffset, setBrowseOffset] = useState(0);
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [prefillDraft, setPrefillDraft] = useState<DataDashboardDraft | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        const currentToken = getToken();
        if (!currentToken) {
            router.replace("/login");
            return;
        }
        if (!hasRole("superadmin")) {
            router.replace("/dashboard");
            return;
        }
        if (pathname?.startsWith("/dashboard/data/")) {
            const query = searchParams.toString();
            router.replace(`/admin/experimental/data-dashboard/${projectId}${query ? `?${query}` : ""}`);
            return;
        }
        setToken(currentToken);
    }, [pathname, projectId, router, searchParams]);

    useEffect(() => {
        if (!token || !projectId) return;
        void refreshDatasets(token, projectId);
    }, [token, projectId]);

    useEffect(() => {
        if (!token || !projectId || !selectedAssetId) return;
        void refreshDatasetProfile(token, projectId, selectedAssetId);
    }, [token, projectId, selectedAssetId]);

    useEffect(() => {
        if (!token || !projectId || !selectedAssetId || !selectedTableName) return;
        void refreshTableAnalysis(token, projectId, selectedAssetId, selectedTableName);
    }, [token, projectId, selectedAssetId, selectedTableName]);

    useEffect(() => {
        if (searchParams.get("prefilled") !== "1") return;
        try {
            const raw = sessionStorage.getItem(`${DATA_DASHBOARD_PREFILL_KEY_PREFIX}${projectId}`);
            if (!raw) return;
            const parsed = JSON.parse(raw) as DataDashboardDraft;
            setPrefillDraft(parsed);
            sessionStorage.removeItem(`${DATA_DASHBOARD_PREFILL_KEY_PREFIX}${projectId}`);
        } catch {
            // Ignore malformed or unavailable session storage and fall back to runtime-only mode.
        }
    }, [projectId, searchParams]);

    const currentTable = useMemo(
        () => profile?.tables.find((table) => table.name === selectedTableName) ?? profile?.tables[0] ?? null,
        [profile, selectedTableName],
    );

    const allColumns = useMemo(() => currentTable?.columns ?? [], [currentTable]);

    async function refreshDatasets(currentToken: string, currentProjectId: string) {
        setLoading(true);
        setError("");
        try {
            const response = await listProjectDatasets(currentToken, currentProjectId);
            setDatasetItems(response.datasets);
            if (!selectedAssetId && response.datasets.length > 0) {
                setSelectedAssetId(response.datasets[0]!.id);
            }
        } catch (err) {
            setError(err instanceof ApiError ? `Unable to load datasets (${err.status})` : "Unable to load datasets");
        } finally {
            setLoading(false);
        }
    }

    async function refreshDatasetProfile(currentToken: string, currentProjectId: string, assetId: string) {
        setLoading(true);
        setError("");
        try {
            const loadedProfile = await getDatasetProfile(currentToken, currentProjectId, assetId);
            const nextTableName = loadedProfile.tables[0]?.name ?? "";
            setProfile(loadedProfile);
            setSelectedTableName(nextTableName);
            setQueryResult(null);
            setAskAnswer("");
            setBrowseResult(null);
            setInsights(null);
            setDashboardSuggestion(null);
            resetTableScopedInputs(loadedProfile, nextTableName);
        } catch (err) {
            setError(err instanceof ApiError ? `Unable to load dataset runtime (${err.status})` : "Unable to load dataset runtime");
        } finally {
            setLoading(false);
        }
    }

    async function refreshTableAnalysis(currentToken: string, currentProjectId: string, assetId: string, tableName: string) {
        setLoading(true);
        setError("");
        try {
            const [loadedInsights, loadedDashboard] = await Promise.all([
                getDatasetInsights(currentToken, currentProjectId, assetId, tableName),
                getDatasetDashboardSuggestion(currentToken, currentProjectId, assetId, tableName),
            ]);
            setInsights(loadedInsights);
            setDashboardSuggestion(loadedDashboard);
            setQueryResult(null);
            setAskAnswer("");
            setBrowseResult(null);
        } catch (err) {
            setError(err instanceof ApiError ? `Unable to load table analysis (${err.status})` : "Unable to load table analysis");
        } finally {
            setLoading(false);
        }
    }

    function resetTableScopedInputs(nextProfile: DatasetProfileDto, tableName: string) {
        const table = nextProfile.tables.find((entry) => entry.name === tableName);
        const firstColumn = table?.columns[0]?.key ?? "";
        setQueryColumn(firstColumn);
        setQueryGroupBy("");
        setFilterColumn(firstColumn);
        setFilterValue("");
        setFilterOperator("eq");
        setFilterColumnTwo(firstColumn);
        setFilterValueTwo("");
        setFilterOperatorTwo("eq");
        setBrowseSortColumn(firstColumn);
        setBrowseSortDirection("asc");
        setBrowseOffset(0);
    }

    async function handleUpload() {
        if (!token || !projectId || !uploadFile) return;
        setLoading(true);
        setError("");
        try {
            const uploaded = await uploadProjectAsset(token, projectId, uploadFile, {
                label: uploadFile.name,
                useInProject: false,
                scope: "project",
            });
            setUploadFile(null);
            await refreshDatasets(token, projectId);
            setSelectedAssetId(uploaded.asset.id);
        } catch (err) {
            setError(err instanceof ApiError ? `Upload failed (${err.status})` : "Upload failed");
        } finally {
            setLoading(false);
        }
    }

    function buildQueryFilters(): DatasetQueryInput["filters"] | undefined {
        const filters: NonNullable<DatasetQueryInput["filters"]> = [];
        if (filterColumn && filterValue.trim()) {
            const column = allColumns.find((entry) => entry.key === filterColumn);
            const normalizedValue = coerceFilterValue(filterValue.trim(), column?.valueType);
            filters.push({ column: filterColumn, operator: filterOperator, value: normalizedValue });
        }
        if (filterColumnTwo && filterValueTwo.trim()) {
            const column = allColumns.find((entry) => entry.key === filterColumnTwo);
            const normalizedValue = coerceFilterValue(filterValueTwo.trim(), column?.valueType);
            filters.push({ column: filterColumnTwo, operator: filterOperatorTwo, value: normalizedValue });
        }
        return filters.length > 0 ? filters : undefined;
    }

    async function handleRunQuery(customQuery?: DatasetQueryInput) {
        if (!token || !projectId || !selectedAssetId || !currentTable) return;
        setLoading(true);
        setError("");
        try {
            const response = await queryDataset(token, projectId, selectedAssetId, customQuery ?? {
                tableName: currentTable.name,
                aggregation: queryAggregation,
                column: queryAggregation === "count" ? undefined : queryColumn || undefined,
                groupBy: queryGroupBy || undefined,
                limit: Number(queryLimit) || 10,
                filters: buildQueryFilters(),
            });
            setQueryResult(response);
        } catch (err) {
            setError(err instanceof ApiError ? `Query failed (${err.status})` : "Query failed");
        } finally {
            setLoading(false);
        }
    }

    async function handleAsk() {
        if (!token || !projectId || !selectedAssetId || !question.trim() || !currentTable) return;
        setLoading(true);
        setError("");
        try {
            const response = await askDataset(token, projectId, selectedAssetId, question.trim(), currentTable.name);
            setAskAnswer(response.supported ? response.answer : `${response.answer} ${response.refusalReason ?? ""}`.trim());
            if (response.query) setQueryResult(response.query);
        } catch (err) {
            setError(err instanceof ApiError ? `Question failed (${err.status})` : "Question failed");
        } finally {
            setLoading(false);
        }
    }

    async function handleBrowse(nextOffset?: number) {
        if (!token || !projectId || !selectedAssetId || !currentTable) return;
        const offset = nextOffset ?? browseOffset;
        setLoading(true);
        setError("");
        try {
            const response = await browseDataset(token, projectId, selectedAssetId, {
                tableName: currentTable.name,
                offset,
                limit: 10,
                filters: buildQueryFilters(),
                sort: browseSortColumn ? { column: browseSortColumn, direction: browseSortDirection } : undefined,
            });
            setBrowseResult(response);
            setBrowseOffset(offset);
        } catch (err) {
            setError(err instanceof ApiError ? `Browse failed (${err.status})` : "Browse failed");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen bg-background px-6 py-8 md:px-10">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
                <div className="flex flex-wrap items-center gap-3">
                    <Button variant="outline" onClick={() => router.push("/dashboard")}>Dashboard</Button>
                    <Button
                        variant="outline"
                        onClick={() => {
                            const query = new URLSearchParams();
                            const autoPrompt = prefillDraft?.dashboardGoal?.trim() || searchParams.get("autoPrompt") || "";
                            if (autoPrompt) query.set("autoPrompt", autoPrompt.slice(0, 2000));
                            if (searchParams.get("nativeDataMode") === "1") query.set("nativeDataMode", "1");
                            router.push(`/workspace/${projectId}${query.size > 0 ? `?${query.toString()}` : ""}`);
                        }}
                    >
                        Workspace
                    </Button>
                    <div className="min-w-[220px] flex-1">
                        <h1 className="text-2xl font-semibold text-foreground">Data Dashboard Runtime</h1>
                        <p className="text-sm text-muted-foreground">Grounded analytics for CSV, XLSX, JSON, XML, and SQL dump assets with deterministic facts only.</p>
                    </div>
                    {loading ? <Badge variant="secondary">Loading</Badge> : <Badge variant="outline">Grounded mode</Badge>}
                </div>

                {error ? (
                    <Card className="border-destructive/40">
                        <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
                    </Card>
                ) : null}

                {prefillDraft ? (
                    <Card className="border-primary/30 bg-card/80">
                        <CardHeader>
                            <CardTitle className="text-lg">Native dashboard brief</CardTitle>
                            <CardDescription>
                                Draft prefill generated from the native VibeCore flow. It stays grounded in the uploaded datasets and can be used as the bridge to artifact generation.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 lg:grid-cols-2">
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-foreground">{prefillDraft.dashboardName}</p>
                                    <p className="text-sm text-muted-foreground">{prefillDraft.dashboardGoal}</p>
                                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                                        Audience: {prefillDraft.primaryAudience}
                                    </p>
                                </div>
                                <div className="space-y-3">
                                    <TagRow label="Datasets" values={prefillDraft.primaryDatasets} />
                                    <TagRow label="Entities" values={prefillDraft.mainEntities} />
                                    <TagRow label="KPI candidates" values={prefillDraft.kpiCandidates} />
                                </div>
                            </div>
                            {prefillDraft.questionCandidates.length > 0 ? (
                                <div className="space-y-2">
                                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Analytical questions</p>
                                    <div className="flex flex-wrap gap-2">
                                        {prefillDraft.questionCandidates.map((questionItem) => (
                                            <Badge key={questionItem} variant="outline">{questionItem}</Badge>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>
                ) : null}

                <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Datasets</CardTitle>
                            <CardDescription>Upload and select runtime data assets without touching the website editor.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <Input
                                type="file"
                                accept=".csv,.xlsx,.json,.xml,.sql,text/csv,application/json,application/xml,text/xml,application/sql,text/sql,text/x-sql,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                            />
                            <Button className="w-full" onClick={handleUpload} disabled={!uploadFile || loading}>Upload dataset</Button>
                            <Separator />
                            <div className="space-y-2">
                                {datasetItems.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No dataset assets yet.</p>
                                ) : datasetItems.map((item) => (
                                    <Button
                                        key={item.id}
                                        variant={item.id === selectedAssetId ? "default" : "outline"}
                                        className="h-auto w-full justify-start px-3 py-3 text-left"
                                        onClick={() => setSelectedAssetId(item.id)}
                                    >
                                        <div className="flex w-full flex-col items-start gap-1">
                                            <span className="text-sm font-medium">{item.originalName}</span>
                                            <span className="text-xs text-muted-foreground">{item.mimeType}</span>
                                            <span className="text-xs text-muted-foreground">
                                                {item.profileReady ? "Profile available" : "Profile pending"} · {item.cacheReady ? "runtime cache ready" : "runtime cache on demand"}
                                            </span>
                                        </div>
                                    </Button>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    <div className="space-y-6">
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <MetricCard label="Rows" value={profile?.facts.rowCount ?? 0} />
                            <MetricCard label="Columns" value={profile?.facts.columnCount ?? 0} />
                            <MetricCard label="Numeric" value={profile?.facts.numericColumnCount ?? 0} />
                            <MetricCard label="Dates" value={profile?.facts.dateColumnCount ?? 0} />
                        </div>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Tables</CardTitle>
                                <CardDescription>Select the grounded table to inspect, query, and summarize.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {!profile || profile.tables.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">No table metadata available yet.</p>
                                ) : (
                                    <>
                                        <div className="flex flex-wrap gap-2">
                                            {profile.tables.map((table) => (
                                                <Button
                                                    key={table.name}
                                                    variant={table.name === currentTable?.name ? "default" : "outline"}
                                                    onClick={() => {
                                                        setSelectedTableName(table.name);
                                                        resetTableScopedInputs(profile, table.name);
                                                    }}
                                                >
                                                    {table.name}
                                                </Button>
                                            ))}
                                        </div>
                                        {currentTable ? (
                                            <div className="flex flex-wrap gap-2">
                                                <Badge variant="secondary">rows {currentTable.rowCount}</Badge>
                                                <Badge variant="secondary">columns {currentTable.columnCount}</Badge>
                                                <Badge variant="outline">format {currentTable.sourceFormat}</Badge>
                                            </div>
                                        ) : null}
                                    </>
                                )}
                            </CardContent>
                        </Card>

                        <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">Schema profile</CardTitle>
                                    <CardDescription>Persisted dataset envelope with inferred types and deterministic statistics.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {!currentTable ? (
                                        <p className="text-sm text-muted-foreground">Select a dataset to inspect its schema.</p>
                                    ) : (
                                        <ScrollArea className="h-[420px] pr-4">
                                            <div className="space-y-3">
                                                {currentTable.columns.map((column) => (
                                                    <Card key={column.key} className="shadow-none">
                                                        <CardContent className="flex flex-col gap-2 p-4">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="font-medium text-foreground">{column.label}</span>
                                                                <Badge variant="secondary">{column.valueType}</Badge>
                                                                <Badge variant="outline">distinct {column.distinctCount}</Badge>
                                                                <Badge variant="outline">null {column.nullRatio}</Badge>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground">Samples: {column.sampleValues.join(", ") || "n/a"}</p>
                                                            {column.valueType === "number" ? (
                                                                <p className="text-xs text-muted-foreground">
                                                                    min {String(column.min ?? "n/a")} · max {String(column.max ?? "n/a")} · mean {String(column.mean ?? "n/a")}
                                                                </p>
                                                            ) : null}
                                                        </CardContent>
                                                    </Card>
                                                ))}
                                            </div>
                                        </ScrollArea>
                                    )}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">Grounded insights</CardTitle>
                                    <CardDescription>Salient findings computed directly from the selected table.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    {!insights || insights.insights.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">No insights available yet.</p>
                                    ) : insights.insights.map((insight) => (
                                        <Card key={insight.id} className="shadow-none">
                                            <CardContent className="space-y-2 p-4">
                                                <div className="flex items-center gap-2">
                                                    <Badge variant={insight.severity === "highlight" ? "default" : "secondary"}>{insight.severity}</Badge>
                                                    <span className="font-medium text-foreground">{insight.title}</span>
                                                </div>
                                                <p className="text-sm text-muted-foreground">{insight.summary}</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {insight.facts.map((fact) => (
                                                        <Badge key={`${insight.id}-${fact.label}`} variant="outline">{fact.label}: {String(fact.value)}</Badge>
                                                    ))}
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                </CardContent>
                            </Card>
                        </div>

                        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">Suggested dashboard</CardTitle>
                                    <CardDescription>Deterministic chart and KPI proposals derived from the selected table shape and column semantics.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {!dashboardSuggestion ? (
                                        <p className="text-sm text-muted-foreground">No dashboard suggestions yet.</p>
                                    ) : dashboardSuggestion.sections.map((section) => (
                                        <Card key={section.id} className="shadow-none">
                                            <CardContent className="space-y-3 p-4">
                                                <div>
                                                    <p className="font-medium text-foreground">{section.title}</p>
                                                    <p className="text-sm text-muted-foreground">{section.description}</p>
                                                </div>
                                                {section.charts.map((chart) => (
                                                    <div key={chart.id} className="rounded-md border border-border p-3">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <Badge variant="secondary">{chart.chartType}</Badge>
                                                            <span className="font-medium text-foreground">{chart.title}</span>
                                                        </div>
                                                        <p className="mt-2 text-sm text-muted-foreground">{chart.rationale}</p>
                                                        <Button className="mt-3" variant="outline" onClick={() => handleRunQuery(chart.query)}>Run grounded query</Button>
                                                    </div>
                                                ))}
                                            </CardContent>
                                        </Card>
                                    ))}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">Query & ask</CardTitle>
                                    <CardDescription>Only supported deterministic operations are allowed. Unsupported questions are refused explicitly.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <p className="text-sm font-medium text-foreground">Aggregation</p>
                                        <div className="flex flex-wrap gap-2">
                                            {AGGREGATIONS.map((aggregation) => (
                                                <Button
                                                    key={aggregation}
                                                    variant={queryAggregation === aggregation ? "default" : "outline"}
                                                    onClick={() => setQueryAggregation(aggregation)}
                                                >
                                                    {aggregation}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                    <Input value={queryColumn} onChange={(event) => setQueryColumn(event.target.value)} placeholder="column name" />
                                    <Input value={queryGroupBy} onChange={(event) => setQueryGroupBy(event.target.value)} placeholder="group by column (optional)" />
                                    <Input value={queryLimit} onChange={(event) => setQueryLimit(event.target.value)} placeholder="limit" />
                                    <Separator />
                                    <div className="space-y-2">
                                        <p className="text-sm font-medium text-foreground">Single grounded filter</p>
                                        <Input value={filterColumn} onChange={(event) => setFilterColumn(event.target.value)} placeholder="filter column" />
                                        <div className="flex flex-wrap gap-2">
                                            {FILTER_OPERATORS.map((operator) => (
                                                <Button
                                                    key={operator}
                                                    variant={filterOperator === operator ? "default" : "outline"}
                                                    onClick={() => setFilterOperator(operator)}
                                                >
                                                    {operator}
                                                </Button>
                                            ))}
                                        </div>
                                        <Input value={filterValue} onChange={(event) => setFilterValue(event.target.value)} placeholder="filter value" />
                                        <Separator />
                                        <p className="text-sm font-medium text-foreground">Optional second filter</p>
                                        <Input value={filterColumnTwo} onChange={(event) => setFilterColumnTwo(event.target.value)} placeholder="second filter column" />
                                        <div className="flex flex-wrap gap-2">
                                            {FILTER_OPERATORS.map((operator) => (
                                                <Button
                                                    key={`two-${operator}`}
                                                    variant={filterOperatorTwo === operator ? "default" : "outline"}
                                                    onClick={() => setFilterOperatorTwo(operator)}
                                                >
                                                    {operator}
                                                </Button>
                                            ))}
                                        </div>
                                        <Input value={filterValueTwo} onChange={(event) => setFilterValueTwo(event.target.value)} placeholder="second filter value" />
                                        <Separator />
                                        <p className="text-sm font-medium text-foreground">Row browser sort</p>
                                        <Input value={browseSortColumn} onChange={(event) => setBrowseSortColumn(event.target.value)} placeholder="sort column" />
                                        <div className="flex flex-wrap gap-2">
                                            <Button variant={browseSortDirection === "asc" ? "default" : "outline"} onClick={() => setBrowseSortDirection("asc")}>asc</Button>
                                            <Button variant={browseSortDirection === "desc" ? "default" : "outline"} onClick={() => setBrowseSortDirection("desc")}>desc</Button>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {allColumns.slice(0, 8).map((column) => (
                                            <Button key={column.key} variant="outline" onClick={() => {
                                                setQueryColumn(column.key);
                                                setFilterColumn(column.key);
                                                setFilterColumnTwo(column.key);
                                                setBrowseSortColumn(column.key);
                                            }}
                                            >
                                                {column.key}
                                            </Button>
                                        ))}
                                    </div>
                                    <Button onClick={() => handleRunQuery()} disabled={!currentTable}>Run query</Button>
                                    <Separator />
                                    <Input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask: total revenue, average temperature, top category..." />
                                    <Button variant="outline" onClick={handleAsk} disabled={!question.trim() || !currentTable}>Ask the dataset</Button>
                                    {askAnswer ? (
                                        <Card className="shadow-none">
                                            <CardContent className="p-4 text-sm text-foreground">{askAnswer}</CardContent>
                                        </Card>
                                    ) : null}
                                </CardContent>
                            </Card>
                        </div>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Query result</CardTitle>
                                <CardDescription>Every result is grounded and paired with the facts used to compute it.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {!queryResult ? (
                                    <p className="text-sm text-muted-foreground">Run a query or a supported natural-language question.</p>
                                ) : (
                                    <>
                                        <div className="flex flex-wrap gap-2">
                                            {queryResult.facts.map((fact) => (
                                                <Badge key={`${fact.label}-${String(fact.value)}`} variant="outline">{fact.label}: {String(fact.value)}</Badge>
                                            ))}
                                        </div>
                                        <Card className="shadow-none">
                                            <CardContent className="p-4">
                                                {Array.isArray(queryResult.result) ? (
                                                    <div className="space-y-2">
                                                        {queryResult.result.map((entry) => (
                                                            <div key={entry.key} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                                                                <span className="text-sm text-foreground">{entry.key}</span>
                                                                <Badge variant="secondary">{entry.value}</Badge>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <p className="text-2xl font-semibold text-foreground">{String(queryResult.result)}</p>
                                                )}
                                            </CardContent>
                                        </Card>
                                    </>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Row browser</CardTitle>
                                <CardDescription>Runtime rows are paginated directly from the grounded table view.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex flex-wrap gap-2">
                                    <Button variant="outline" onClick={() => handleBrowse(Math.max(0, browseOffset - 10))} disabled={!currentTable || browseOffset === 0}>Previous</Button>
                                    <Button variant="outline" onClick={() => handleBrowse(browseOffset + 10)} disabled={!currentTable}>Next</Button>
                                    <Button onClick={() => handleBrowse(0)} disabled={!currentTable}>Browse rows</Button>
                                </div>
                                {!browseResult ? (
                                    <p className="text-sm text-muted-foreground">Run row browsing to inspect runtime data beyond the static sample.</p>
                                ) : (
                                    <>
                                        <div className="flex flex-wrap gap-2">
                                            <Badge variant="secondary">offset {browseResult.offset}</Badge>
                                            <Badge variant="secondary">page size {browseResult.limit}</Badge>
                                            <Badge variant="outline">rows after filters {browseResult.totalRowsAfterFilters}</Badge>
                                            {browseResult.sort ? <Badge variant="outline">sort {browseResult.sort.column} {browseResult.sort.direction}</Badge> : null}
                                        </div>
                                        <ScrollArea className="h-[320px] rounded-md border border-border p-3">
                                            <div className="space-y-3">
                                                {browseResult.rows.map((row, rowIndex) => (
                                                    <Card key={`${browseResult.offset}-${rowIndex}`} className="shadow-none">
                                                        <CardContent className="space-y-2 p-4">
                                                            {browseResult.columns.map((column) => (
                                                                <div key={`${browseResult.offset}-${rowIndex}-${column}`} className="flex items-start justify-between gap-4">
                                                                    <span className="text-xs font-medium text-muted-foreground">{column}</span>
                                                                    <span className="text-xs text-foreground">{String(row[column] ?? "null")}</span>
                                                                </div>
                                                            ))}
                                                        </CardContent>
                                                    </Card>
                                                ))}
                                            </div>
                                        </ScrollArea>
                                    </>
                                )}
                            </CardContent>
                        </Card>

                        {(profile?.limitations.length ?? 0) > 0 ? (
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">Current limitations</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    {profile?.limitations.map((limitation) => (
                                        <Badge key={limitation} variant="outline">{limitation}</Badge>
                                    ))}
                                </CardContent>
                            </Card>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

function coerceFilterValue(rawValue: string, valueType?: DatasetProfileDto["tables"][number]["columns"][number]["valueType"]) {
    if (valueType === "number") {
        const normalized = Number(rawValue.replace(",", "."));
        return Number.isFinite(normalized) ? normalized : rawValue;
    }
    if (valueType === "boolean") {
        if (/^(true|yes|y|si|sì)$/i.test(rawValue)) return true;
        if (/^(false|no|n)$/i.test(rawValue)) return false;
    }
    if (valueType === "date") {
        return rawValue;
    }
    if (rawValue.includes(",")) {
        return rawValue.split(",").map((entry) => entry.trim()).filter(Boolean);
    }
    return rawValue;
}

function MetricCard({ label, value }: { label: string; value: number }) {
    return (
        <Card>
            <CardContent className="flex flex-col gap-1 p-4">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-2xl font-semibold text-foreground">{value}</span>
            </CardContent>
        </Card>
    );
}

function TagRow({ label, values }: { label: string; values: string[] }) {
    if (values.length === 0) return null;
    return (
        <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
            <div className="flex flex-wrap gap-2">
                {values.map((value) => (
                    <Badge key={`${label}-${value}`} variant="secondary">{value}</Badge>
                ))}
            </div>
        </div>
    );
}
