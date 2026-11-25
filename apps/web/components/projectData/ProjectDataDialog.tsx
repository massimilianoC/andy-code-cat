"use client";

/**
 * Project data panel (docs/specs/PROJECT_DATA_PANEL.md): every record a platform capability stored
 * for the project — leaderboards today, more capabilities later, with no change here. The owner
 * can browse, view one record as JSON, delete it, clear a group or a whole capability (typed
 * confirmation), and export JSON or CSV.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, Database, Download, Eye, Search, Trash2 } from "lucide-react";
import {
    PROJECT_DATA_EXPORT_MAX_RECORDS,
    type ProjectDataCapabilitySummaryDto,
    type ProjectDataRecordDto,
    type ProjectDataRecordPageDto,
    type ProjectDataSummaryDto,
} from "@andy-code-cat/contracts";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getToken } from "@/lib/token-store";
import { ApiError } from "@/lib/api/call";
import {
    clearProjectData,
    deleteProjectDataRecord,
    downloadProjectDataExport,
    getProjectDataSummary,
    listProjectDataRecords,
    type ProjectDataExportFormat,
} from "@/lib/api/projectData";
import { pageCount, previewOfData, prettyJson, visibleRange } from "./projectDataView";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

interface ProjectDataDialogProps {
    projectId: string;
    open: boolean;
    onClose: () => void;
}

function errorText(error: unknown, fallback: string): string {
    if (error instanceof ApiError) return error.userMessage ?? error.message ?? fallback;
    return fallback;
}

export default function ProjectDataDialog({ projectId, open, onClose }: ProjectDataDialogProps) {
    const { t, i18n } = useTranslation();
    const token = useMemo(() => (open ? getToken() ?? "" : ""), [open]);

    const [summary, setSummary] = useState<ProjectDataSummaryDto | null>(null);
    const [summaryError, setSummaryError] = useState<string | null>(null);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [groupId, setGroupId] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [records, setRecords] = useState<ProjectDataRecordPageDto | null>(null);
    const [recordsLoading, setRecordsLoading] = useState(false);
    const [recordsError, setRecordsError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [viewing, setViewing] = useState<ProjectDataRecordDto | null>(null);
    const [deleting, setDeleting] = useState<ProjectDataRecordDto | null>(null);
    const [clearing, setClearing] = useState<{ groupId?: string } | null>(null);
    const [exporting, setExporting] = useState<ProjectDataExportFormat | null>(null);
    const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    const formatDate = useCallback(
        (iso?: string) => (iso ? new Date(iso).toLocaleString(i18n.language || undefined) : "—"),
        [i18n.language],
    );

    const capabilities = summary?.capabilities ?? [];
    const active: ProjectDataCapabilitySummaryDto | undefined = capabilities.find((c) => c.id === activeId) ?? capabilities[0];
    const activeGroup = active?.groups.find((g) => g.id === groupId);
    const activeCapabilityId = active?.id;

    // ── Loading ────────────────────────────────────────────────────────────────────────────────
    const loadSummary = useCallback(async () => {
        if (!token) return;
        try {
            setSummaryError(null);
            const next = await getProjectDataSummary(token, projectId);
            setSummary(next);
            setActiveId((current) => {
                if (current && next.capabilities.some((c) => c.id === current)) return current;
                return (next.capabilities.find((c) => c.records > 0) ?? next.capabilities[0])?.id ?? null;
            });
        } catch (error) {
            setSummaryError(errorText(error, t("projectData.loadError")));
        }
    }, [projectId, t, token]);

    const loadRecords = useCallback(async () => {
        if (!token || !activeCapabilityId) return;
        setRecordsLoading(true);
        try {
            setRecordsError(null);
            setRecords(await listProjectDataRecords(token, projectId, activeCapabilityId, {
                groupId: groupId || undefined,
                search: search || undefined,
                page,
                limit: PAGE_SIZE,
            }));
        } catch (error) {
            setRecordsError(errorText(error, t("projectData.loadError")));
        } finally {
            setRecordsLoading(false);
        }
    }, [activeCapabilityId, groupId, page, projectId, search, t, token]);

    useEffect(() => {
        if (!open) {
            setSummary(null);
            setRecords(null);
            setNotice(null);
            setSearchInput("");
            setSearch("");
            setGroupId("");
            setPage(1);
            return;
        }
        void loadSummary();
    }, [open, loadSummary]);

    useEffect(() => {
        if (open) void loadRecords();
    }, [open, loadRecords]);

    useEffect(() => {
        const handle = setTimeout(() => {
            setSearch(searchInput.trim().slice(0, 100));
            setPage(1);
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [searchInput]);

    // ── Actions ────────────────────────────────────────────────────────────────────────────────
    function selectCapability(id: string) {
        setActiveId(id);
        setGroupId("");
        setPage(1);
        setNotice(null);
    }

    function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
        const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        let next: number | undefined;
        if (event.key in keys) next = (index + keys[event.key] + capabilities.length) % capabilities.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = capabilities.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        const target = capabilities[next];
        selectCapability(target.id);
        tabRefs.current[target.id]?.focus();
    }

    async function refreshAfterChange(message: string) {
        setNotice(message);
        await Promise.all([loadSummary(), loadRecords()]);
    }

    async function confirmDelete() {
        if (!deleting || !active) return;
        const record = deleting;
        setDeleting(null);
        try {
            await deleteProjectDataRecord(token, projectId, active.id, record.id);
            if (records && records.items.length === 1 && page > 1) setPage(page - 1);
            await refreshAfterChange(t("projectData.deleted"));
        } catch (error) {
            setNotice(errorText(error, t("projectData.actionError")));
        }
    }

    async function confirmClear(confirm: string) {
        if (!clearing || !active) return;
        const target = clearing;
        setClearing(null);
        try {
            const { removed } = await clearProjectData(token, projectId, active.id, { groupId: target.groupId, confirm });
            if (target.groupId) setGroupId("");
            setPage(1);
            await refreshAfterChange(t("projectData.cleared", { count: removed }));
        } catch (error) {
            setNotice(errorText(error, t("projectData.actionError")));
        }
    }

    async function runExport(format: ProjectDataExportFormat) {
        if (!active) return;
        setExporting(format);
        setNotice(null);
        try {
            await downloadProjectDataExport(projectId, active.id, { format, groupId: groupId || undefined });
        } catch (error) {
            setNotice(errorText(error, t("projectData.exportError")));
        } finally {
            setExporting(null);
        }
    }

    // ── Render ─────────────────────────────────────────────────────────────────────────────────
    const total = records?.total ?? 0;
    const pages = pageCount(total, PAGE_SIZE);
    const range = visibleRange(page, PAGE_SIZE, total);
    const selectionCount = activeGroup ? activeGroup.records : active?.records ?? 0;
    const hasAnyRecord = (active?.records ?? 0) > 0;

    return (
        <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
            <DialogContent className="max-w-5xl w-[calc(100vw-2rem)] p-0 overflow-hidden">
                <div className="flex flex-col h-[85vh]">
                    <DialogHeader className="px-6 py-4 border-b border-border shrink-0">
                        <DialogTitle className="flex items-center gap-2">
                            <Database className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                            {t("projectData.title")}
                        </DialogTitle>
                        <DialogDescription>{t("projectData.description")}</DialogDescription>
                    </DialogHeader>

                    {summaryError ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                            <p role="alert" className="text-sm text-destructive">{summaryError}</p>
                            <Button variant="outline" size="sm" onClick={() => void loadSummary()}>{t("projectData.retry")}</Button>
                        </div>
                    ) : !summary ? (
                        <div className="flex-1 flex items-center justify-center" aria-busy="true">
                            <p className="text-sm text-muted-foreground">{t("projectData.loading")}</p>
                        </div>
                    ) : capabilities.length === 0 || !active ? (
                        <EmptyState title={t("projectData.empty")} />
                    ) : (
                        <div className="flex-1 flex flex-col min-h-0">
                            {/* Capabilities */}
                            <div role="tablist" aria-label={t("projectData.tabsLabel")} className="flex gap-2 overflow-x-auto px-6 pt-4 shrink-0">
                                {capabilities.map((capability, index) => {
                                    const selected = capability.id === active.id;
                                    return (
                                        <button
                                            key={capability.id}
                                            ref={(node) => { tabRefs.current[capability.id] = node; }}
                                            type="button"
                                            role="tab"
                                            id={`project-data-tab-${capability.id}`}
                                            aria-selected={selected}
                                            aria-controls="project-data-panel"
                                            tabIndex={selected ? 0 : -1}
                                            onClick={() => selectCapability(capability.id)}
                                            onKeyDown={(event) => onTabKeyDown(event, index)}
                                            className={cn(
                                                "min-w-[11rem] rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                selected ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-secondary",
                                            )}
                                        >
                                            <span className="flex items-center justify-between gap-2">
                                                <span className="text-sm font-medium text-foreground">{capability.label}</span>
                                                <Badge variant={capability.records > 0 ? "accent" : "outline"}>{capability.records}</Badge>
                                            </span>
                                            <span className="block text-xs text-muted-foreground mt-0.5">
                                                {capability.lastWriteAt
                                                    ? t("projectData.lastWrite", { date: formatDate(capability.lastWriteAt) })
                                                    : t("projectData.noWrites")}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>

                            <div
                                id="project-data-panel"
                                role="tabpanel"
                                aria-labelledby={`project-data-tab-${active.id}`}
                                className="flex-1 flex flex-col min-h-0 px-6 pb-4 pt-3 gap-3"
                            >
                                {/* Toolbar */}
                                <div className="flex flex-wrap items-end gap-2 shrink-0">
                                    <div className="flex flex-col gap-1">
                                        <Label htmlFor="project-data-group" className="text-xs text-muted-foreground">{t("projectData.groupFilter")}</Label>
                                        <select
                                            id="project-data-group"
                                            value={groupId}
                                            onChange={(event) => { setGroupId(event.target.value); setPage(1); }}
                                            disabled={active.groups.length === 0}
                                            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                                        >
                                            <option value="">{t("projectData.allGroups", { count: active.records })}</option>
                                            {active.groups.map((group) => (
                                                <option key={group.id} value={group.id}>{`${group.label} (${group.records})`}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
                                        <Label htmlFor="project-data-search" className="text-xs text-muted-foreground">{t("projectData.search")}</Label>
                                        <div className="relative">
                                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                                            <Input
                                                id="project-data-search"
                                                type="search"
                                                value={searchInput}
                                                maxLength={100}
                                                onChange={(event) => setSearchInput(event.target.value)}
                                                placeholder={t("projectData.searchPlaceholder")}
                                                className="pl-8"
                                                disabled={!hasAnyRecord}
                                            />
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={!hasAnyRecord || exporting !== null} onClick={() => void runExport("csv")}>
                                            <Download className="w-4 h-4" aria-hidden="true" />
                                            {exporting === "csv" ? t("projectData.exporting") : t("projectData.exportCsv")}
                                        </Button>
                                        <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={!hasAnyRecord || exporting !== null} onClick={() => void runExport("json")}>
                                            <Download className="w-4 h-4" aria-hidden="true" />
                                            {exporting === "json" ? t("projectData.exporting") : t("projectData.exportJson")}
                                        </Button>
                                        {activeGroup ? (
                                            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-destructive" onClick={() => setClearing({ groupId: activeGroup.id })}>
                                                <Trash2 className="w-4 h-4" aria-hidden="true" />
                                                {t("projectData.clearGroup")}
                                            </Button>
                                        ) : null}
                                        <Button variant="destructive" size="sm" className="h-9 gap-1.5" disabled={!hasAnyRecord} onClick={() => setClearing({})}>
                                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                                            {t("projectData.clearAll")}
                                        </Button>
                                    </div>
                                </div>

                                <div aria-live="polite" className="min-h-[1.25rem] text-xs text-muted-foreground shrink-0">
                                    {notice ?? (hasAnyRecord && selectionCount > PROJECT_DATA_EXPORT_MAX_RECORDS
                                        ? t("projectData.exportLimit", { max: PROJECT_DATA_EXPORT_MAX_RECORDS })
                                        : null)}
                                </div>

                                {/* Records */}
                                <div className="flex-1 min-h-0 overflow-auto rounded-md border border-border" aria-busy={recordsLoading}>
                                    {recordsError ? (
                                        <p role="alert" className="p-6 text-sm text-destructive text-center">{recordsError}</p>
                                    ) : !hasAnyRecord ? (
                                        <EmptyState title={t("projectData.empty")} />
                                    ) : records && records.items.length === 0 && !recordsLoading ? (
                                        <EmptyState title={t("projectData.noMatches")} />
                                    ) : (
                                        <table className="w-full text-sm">
                                            <caption className="sr-only">{t("projectData.tableCaption", { label: active.label })}</caption>
                                            <thead className="sticky top-0 bg-muted text-muted-foreground text-xs">
                                                <tr>
                                                    <th scope="col" className="text-left font-medium px-3 py-2 whitespace-nowrap">{t("projectData.columns.createdAt")}</th>
                                                    <th scope="col" className="text-left font-medium px-3 py-2">{t("projectData.columns.group")}</th>
                                                    <th scope="col" className="text-left font-medium px-3 py-2 w-full">{t("projectData.columns.data")}</th>
                                                    <th scope="col" className="text-right font-medium px-3 py-2"><span className="sr-only">{t("projectData.columns.actions")}</span></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(records?.items ?? []).map((record) => (
                                                    <tr
                                                        key={record.id}
                                                        className="border-t border-border hover:bg-secondary/60 cursor-pointer"
                                                        onClick={() => setViewing(record)}
                                                    >
                                                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDate(record.createdAt)}</td>
                                                        <td className="px-3 py-2 whitespace-nowrap"><Badge variant="outline">{record.groupId}</Badge></td>
                                                        <td className="px-3 py-2 max-w-0 truncate text-foreground" title={previewOfData(record.data, 1000)}>{previewOfData(record.data)}</td>
                                                        <td className="px-3 py-1 whitespace-nowrap text-right" onClick={(event) => event.stopPropagation()}>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("projectData.view")} title={t("projectData.view")} onClick={() => setViewing(record)}>
                                                                <Eye className="w-4 h-4" aria-hidden="true" />
                                                            </Button>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" aria-label={t("projectData.delete")} title={t("projectData.delete")} onClick={() => setDeleting(record)}>
                                                                <Trash2 className="w-4 h-4" aria-hidden="true" />
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>

                                {/* Pagination */}
                                {hasAnyRecord && total > 0 ? (
                                    <nav aria-label={t("projectData.pagination")} className="flex items-center justify-between gap-2 shrink-0 text-xs text-muted-foreground">
                                        <span>{t("projectData.showing", { from: range.from, to: range.to, total })}</span>
                                        <span className="flex items-center gap-2">
                                            <Button variant="outline" size="sm" disabled={page <= 1 || recordsLoading} onClick={() => setPage(page - 1)}>{t("projectData.pagePrev")}</Button>
                                            <span>{t("projectData.pageOf", { page, pages })}</span>
                                            <Button variant="outline" size="sm" disabled={page >= pages || recordsLoading} onClick={() => setPage(page + 1)}>{t("projectData.pageNext")}</Button>
                                        </span>
                                    </nav>
                                ) : null}
                            </div>
                        </div>
                    )}

                    <DialogFooter className="px-6 py-3 border-t border-border shrink-0">
                        <Button variant="ghost" onClick={onClose}>{t("projectData.close")}</Button>
                    </DialogFooter>
                </div>
            </DialogContent>

            <RecordDialog record={viewing} onClose={() => setViewing(null)} formatDate={formatDate} />

            <Dialog open={deleting !== null} onOpenChange={(value) => !value && setDeleting(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t("projectData.deleteTitle")}</DialogTitle>
                        <DialogDescription>{t("projectData.deleteBody")}</DialogDescription>
                    </DialogHeader>
                    {deleting ? <p className="text-sm text-foreground break-words">{previewOfData(deleting.data, 200)}</p> : null}
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setDeleting(null)}>{t("projectData.cancel")}</Button>
                        <Button variant="destructive" onClick={() => void confirmDelete()}>{t("projectData.deleteConfirm")}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {active ? (
                <ClearDialog
                    target={clearing}
                    capability={active}
                    onCancel={() => setClearing(null)}
                    onConfirm={(confirm) => void confirmClear(confirm)}
                />
            ) : null}
        </Dialog>
    );
}

function EmptyState({ title }: { title: string }) {
    return (
        <div className="h-full min-h-[12rem] flex flex-col items-center justify-center gap-3 p-8 text-center">
            <Database className="w-10 h-10 text-muted-foreground/40" aria-hidden="true" />
            <p className="text-sm text-muted-foreground max-w-md">{title}</p>
        </div>
    );
}

function RecordDialog({ record, onClose, formatDate }: { record: ProjectDataRecordDto | null; onClose: () => void; formatDate: (iso?: string) => string }) {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);
    const json = record ? prettyJson(record) : "";

    useEffect(() => setCopied(false), [record]);

    async function copy() {
        try {
            await navigator.clipboard.writeText(json);
            setCopied(true);
            setTimeout(() => setCopied(false), 2_000);
        } catch {
            setCopied(false);
        }
    }

    return (
        <Dialog open={record !== null} onOpenChange={(value) => !value && onClose()}>
            <DialogContent className="max-w-2xl w-[calc(100vw-2rem)]">
                <DialogHeader>
                    <DialogTitle>{t("projectData.recordTitle")}</DialogTitle>
                    <DialogDescription>
                        {record ? t("projectData.recordMeta", { group: record.groupId, date: formatDate(record.createdAt) }) : null}
                    </DialogDescription>
                </DialogHeader>
                <pre
                    tabIndex={0}
                    aria-label={t("projectData.recordJson")}
                    className="max-h-[55vh] overflow-auto rounded-md border border-border bg-muted p-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {json}
                </pre>
                <DialogFooter>
                    <span aria-live="polite" className="sr-only">{copied ? t("projectData.copied") : ""}</span>
                    <Button variant="outline" className="gap-1.5" onClick={() => void copy()}>
                        {copied ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                        {copied ? t("projectData.copied") : t("projectData.copy")}
                    </Button>
                    <Button onClick={onClose}>{t("projectData.close")}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ClearDialog({
    target,
    capability,
    onCancel,
    onConfirm,
}: {
    target: { groupId?: string } | null;
    capability: ProjectDataCapabilitySummaryDto;
    onCancel: () => void;
    onConfirm: (confirm: string) => void;
}) {
    const { t } = useTranslation();
    const [typed, setTyped] = useState("");
    const group = target?.groupId ? capability.groups.find((g) => g.id === target.groupId) : undefined;
    const count = target?.groupId ? group?.records ?? 0 : capability.records;
    const matches = typed.trim() === capability.id;

    useEffect(() => setTyped(""), [target]);

    return (
        <Dialog open={target !== null} onOpenChange={(value) => !value && onCancel()}>
            <DialogContent className="max-w-md">
                <form
                    className="grid gap-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (matches) onConfirm(typed.trim());
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>
                            {target?.groupId
                                ? t("projectData.clearGroupTitle", { group: group?.label ?? target.groupId })
                                : t("projectData.clearAllTitle", { label: capability.label })}
                        </DialogTitle>
                        <DialogDescription>{t("projectData.clearBody", { count })}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-1.5">
                        <Label htmlFor="project-data-clear-confirm">
                            {t("projectData.clearTypeToConfirm", { id: capability.id })}
                        </Label>
                        <Input
                            id="project-data-clear-confirm"
                            value={typed}
                            onChange={(event) => setTyped(event.target.value)}
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            placeholder={capability.id}
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={onCancel}>{t("projectData.cancel")}</Button>
                        <Button type="submit" variant="destructive" disabled={!matches}>{t("projectData.clearConfirm")}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
