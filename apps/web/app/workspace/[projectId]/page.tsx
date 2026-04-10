"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useRouter, useParams } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import {
    getOrCreateProjectConversation,
    addMessage,
    llmChatPreview,
    streamLlmChatPreview,
    getLlmProviders,
    logBackgroundTask,
    getLlmPromptConfig,
    getLlmPromptPreview,
    setLlmPromptConfig,
    type LlmPromptPreviewDto,
    listPreviewSnapshots,
    createPreviewSnapshot,
    activatePreviewSnapshot,
    deletePreviewSnapshot,
    createWysiwygEditSession,
    saveWysiwygEditState,
    commitWysiwygSession,
    ApiError,
    getProject,
    getPresets,
    type ConversationDetail,
    type ProjectPreset,
    type MessageDto,
    type PreviewSnapshot,
    type LlmProviderCatalogDto,
    type LlmFocusContext,
    type LlmChatDefaults,
    type LlmChatStreamEvent,
    requestLayer1Export,
    downloadExportBlob,
    downloadSnapshotCapture,
    publishProject,
    getPublishStatus,
    unpublishProject,
    checkSlugAvailability,
    updateDeploymentSlug,
    type SiteDeploymentDto,
} from "../../../lib/api";
import { getToken } from "../../../lib/token-store";
import { useNotifications } from "../../../lib/notifications";
import { saveThumbnail, savePromptExcerpt, incrementSnapCount } from "../../../lib/thumbnail";
import ProjectConfigPopup from "../../../components/ProjectConfigPopup";
import { Settings } from "lucide-react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
    ssr: false,
});



const SPLIT_COOKIE = "andy-code-cat_workspace_split";

function getCookie(name: string): string | null {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days = 365) {
    if (typeof document === "undefined") return;
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

// ── Model dropdown helpers ────────────────────────────────────────────────────
type ModelItem = LlmProviderCatalogDto["models"][number];

// ── Cost formatting helper ────────────────────────────────────────────────────
/**
 * Formats a EUR cost amount for compact display.
 * Returns empty string for zero / undefined (no badge shown).
 */
function formatCostEur(amount: number | undefined): string {
    if (!amount || amount <= 0) return "";
    if (amount < 0.0001) return "<€0.0001";
    if (amount < 0.01)   return `€${amount.toFixed(4)}`;
    if (amount < 1)      return `€${amount.toFixed(3)}`;
    return `€${amount.toFixed(2)}`;
}

/** Extract family/namespace from a model ID (part before the first "/"). */
function modelFamily(id: string): string {
    if (id.includes("/")) return id.slice(0, id.indexOf("/"));
    // No namespace: derive from leading alpha word (e.g. "llama", "qwen", "phi")
    const m = id.match(/^([a-zA-Z]+)/);
    return m ? m[1] : "other";
}

/** Short display name: strip the namespace prefix when present. */
function modelShortName(id: string): string {
    const slash = id.indexOf("/");
    return slash >= 0 ? id.slice(slash + 1) : id;
}

/** Cost-tier badge prefix for paid models. */
function tierBadge(tier: ModelItem["priceTier"]): string {
    if (tier === "€")    return "€ ";
    if (tier === "€€")   return "€€ ";
    if (tier === "€€€")  return "€€€ ";
    if (tier === "€€€€") return "€€€€ ";
    return "";
}

/**
 * Renders <optgroup> sections for a model list:
 * - paid models grouped by family (alphabetical)
 * - free models grouped by family (alphabetical), pushed to the bottom with a divider
 */
function groupedModelOptions(models: ModelItem[]): React.ReactNode {
    const paid = models.filter((m) => m.priceTier !== "free");
    const free = models.filter((m) => m.priceTier === "free");

    function intoFamilyGroups(list: ModelItem[]): [string, ModelItem[]][] {
        const map = new Map<string, ModelItem[]>();
        for (const m of list) {
            const fam = modelFamily(m.id);
            if (!map.has(fam)) map.set(fam, []);
            map.get(fam)!.push(m);
        }
        return [...map.entries()].sort(([a], [b]) =>
            a.localeCompare(b, undefined, { sensitivity: "base" })
        );
    }

    const paidGroups = intoFamilyGroups(paid);
    const freeGroups = intoFamilyGroups(free);

    return (
        <>
            {paidGroups.map(([family, items]) => (
                <optgroup key={`g-${family}`} label={family}>
                    {items
                        .sort((a, b) => a.id.localeCompare(b.id))
                        .map((m) => (
                            <option key={m.id} value={m.id}>
                                {tierBadge(m.priceTier)}{modelShortName(m.id)}
                            </option>
                        ))}
                </optgroup>
            ))}
            {freeGroups.length > 0 && (
                <>
                    <option disabled value="">── 🆓 Free models ──</option>
                    {freeGroups.map(([family, items]) => (
                        <optgroup key={`gf-${family}`} label={`🆓 ${family}`}>
                            {items
                                .sort((a, b) => a.id.localeCompare(b.id))
                                .map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {modelShortName(m.id)}
                                    </option>
                                ))}
                        </optgroup>
                    ))}
                </>
            )}
        </>
    );
}
// ── End model dropdown helpers ───────────────────────────────────────────────

export default function WorkspacePage() {
    const router = useRouter();
    const params = useParams();
    const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;

    const { add: addNotification, update: updateNotification } = useNotifications();

    const [token, setToken] = useState<string | null>(null);
    const [checkingAuth, setCheckingAuth] = useState(true);

    const [activeConv, setActiveConv] = useState<ConversationDetail | null>(null);
    const [activeConvId, setActiveConvId] = useState<string | null>(null);
    const [conversationLoading, setConversationLoading] = useState(true);

    const [projectName, setProjectName] = useState("");
    const [configOpen, setConfigOpen] = useState(false);
    const [projectPresetId, setProjectPresetId] = useState<string | undefined>(undefined);
    const [presetCatalog, setPresetCatalog] = useState<ProjectPreset[]>([]);

    const [prompt, setPrompt] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [promptConfigVersion, setPromptConfigVersion] = useState<string>("v1");
    // Chat defaults are driven by the backend (GET /llm/prompt-config).
    // Clients must never hardcode these values — always use what the backend returns.
    const [chatDefaults, setChatDefaults] = useState<LlmChatDefaults>({
        temperature: 0.4,
        pipelineRole: "dialogue",
        capability: "chat",
        historyMaxMessages: 12,
        historyMessageMaxChars: 2000,
        maxCompletionTokens: 8000,
    });
    const [thinkingText, setThinkingText] = useState("");
    const [draftAnswer, setDraftAnswer] = useState("");
    const [streamPromptTokens, setStreamPromptTokens] = useState(0);
    const [streamUsageTokens, setStreamUsageTokens] = useState<{
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    } | null>(null);
    const [providersCatalog, setProvidersCatalog] = useState<LlmProviderCatalogDto[]>([]);
    const [selectedProvider, setSelectedProvider] = useState<string>("");
    const [selectedModel, setSelectedModel] = useState<string>("");

    const [leftWidth, setLeftWidth] = useState(40);
    const [isDragging, setIsDragging] = useState(false);
    const [previewTab, setPreviewTab] = useState<"preview" | "html" | "css" | "js" | "prompt">("preview");
    const [promptTemplate, setPromptTemplate] = useState("");
    const [promptEnabled, setPromptEnabled] = useState(true);
    const [isSavingPrompt, setIsSavingPrompt] = useState(false);
    const [promptPreview, setPromptPreview] = useState<LlmPromptPreviewDto | null>(null);
    const [loadingPromptPreview, setLoadingPromptPreview] = useState(false);
    const [previewSnapshots, setPreviewSnapshots] = useState<PreviewSnapshot[]>([]);
    const [selectedBackendSnapshotId, setSelectedBackendSnapshotId] = useState<string | null>(null);
    const [loadingSnapshots, setLoadingSnapshots] = useState(false);
    const [editorHtml, setEditorHtml] = useState("");
    const [editorCss, setEditorCss] = useState("");
    const [editorJs, setEditorJs] = useState("");
    const [editorSelectionLabel, setEditorSelectionLabel] = useState<string>("Nessuna selezione");
    const [inspectMode, setInspectMode] = useState(false);
    const [selectedElement, setSelectedElement] = useState<LlmFocusContext["selectedElement"] | null>(null);
    const [codeEditorSelection, setCodeEditorSelection] = useState<LlmFocusContext["codeSelection"] | null>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // ── WYSIWYG EDIT mode state ──────────────────────────────────────────────
    const [editMode, setEditMode] = useState(false);
    const [editSessionId, setEditSessionId] = useState<string | null>(null);
    const [isSavingEditVersion, setIsSavingEditVersion] = useState(false);
    const editAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingEditHtmlRef = useRef<string | null>(null);
    const handleCommitEditVersionRef = useRef<(html: string) => Promise<void>>(null as any);

    const [exportState, setExportState] = useState<"idle" | "loading" | "error">("idle");
    const [exportError, setExportError] = useState<string | null>(null);
    const [captureState, setCaptureState] = useState<"idle" | "loading" | "error">("idle");
    // Preview refresh feedback
    const [previewRefreshing, setPreviewRefreshing] = useState(false);
    const [previewPending, setPreviewPending] = useState(false);
    // Watchdog: bumped when iframe fails to fire onLoad within timeout
    const [previewForceKey, setPreviewForceKey] = useState(0);
    const iframeLoadedRef = useRef(false);
    const [captureDropdownOpen, setCaptureDropdownOpen] = useState(false);
    const captureDropdownRef = useRef<HTMLDivElement>(null);

    // Publish state
    const [publishState, setPublishState] = useState<"idle" | "loading" | "error">("idle");
    const [publishDeployment, setPublishDeployment] = useState<SiteDeploymentDto | null>(null);
    const [publishCopied, setPublishCopied] = useState(false);
    // Slug edit state
    const [slugEditMode, setSlugEditMode] = useState(false);
    const [slugInput, setSlugInput] = useState("");
    const [slugCheckState, setSlugCheckState] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
    const [slugSaving, setSlugSaving] = useState(false);
    const slugDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleExportLayer1 = useCallback(async () => {
        if (!token) return;
        setExportState("loading");
        setExportError(null);
        const notifId = addNotification({
            label: "Export ZIP (con screenshot)",
            status: "running",
            message: "Cattura screenshot + archivio in corso…",
        });
        try {
            // 1. Create the export record on the server
            const snapshotId = selectedBackendSnapshotId ?? undefined;
            const res = await requestLayer1Export(token, projectId, snapshotId);

            // 2. Download the ZIP blob using the Bearer token (no JWT-in-URL fragility)
            updateNotification(notifId, { message: "Download ZIP…" });
            const blob = await downloadExportBlob(token, res.id);

            // 3. Trigger browser download
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objectUrl;
            a.download = "export-layer1.zip";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(objectUrl);

            setExportState("idle");
            updateNotification(notifId, { status: "done", message: "ZIP scaricato" });
        } catch (err) {
            // 401 from the blob download = sessione scaduta — mostra la modal
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
                setExportState("idle");
                updateNotification(notifId, { status: "error", message: "Sessione scaduta" });
                return;
            }
            const msg = err instanceof Error ? err.message : "Errore export";
            setExportError(msg);
            setExportState("error");
            updateNotification(notifId, { status: "error", message: msg });
        }
    }, [token, projectId, selectedBackendSnapshotId, addNotification, updateNotification]);

    // Close camera dropdown on outside click
    useEffect(() => {
        function onDown(e: MouseEvent) {
            if (captureDropdownRef.current && !captureDropdownRef.current.contains(e.target as Node)) {
                setCaptureDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, []);

    const handleCaptureSnapshot = useCallback(async (format: "jpg" | "pdf") => {
        if (!token || !selectedBackendSnapshotId) return;
        setCaptureState("loading");
        setCaptureDropdownOpen(false);
        const notifId = addNotification({
            label: `Cattura screenshot ${format.toUpperCase()}`,
            status: "running",
            message: "Rendering pagina in corso…",
        });
        try {
            // Calls the backend Puppeteer endpoint:
            // GET /v1/projects/:projectId/preview-snapshots/:snapshotId/capture?format=jpg|pdf
            const blob = await downloadSnapshotCapture(token, projectId, selectedBackendSnapshotId, format);

            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = objectUrl;
            a.download = `preview-snapshot.${format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(objectUrl);

            setCaptureState("idle");
            updateNotification(notifId, { status: "done", message: "File scaricato" });
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
                setCaptureState("idle");
                updateNotification(notifId, { status: "error", message: "Sessione scaduta" });
                return;
            }
            const msg = err instanceof Error ? err.message : "Errore cattura";
            console.error("[snapshot-capture]", err);
            setCaptureState("error");
            updateNotification(notifId, { status: "error", message: msg });
            window.setTimeout(() => setCaptureState("idle"), 3000);
        }
    }, [token, projectId, selectedBackendSnapshotId, addNotification, updateNotification]);

    // ── Publish handlers ────────────────────────────────────────────
    // Fetch current deployment status on mount / when projectId changes
    useEffect(() => {
        if (!token) return;
        getPublishStatus(token, projectId)
            .then((d) => setPublishDeployment(d))
            .catch(() => setPublishDeployment(null));
    }, [token, projectId]);

    // Debounced slug availability check
    useEffect(() => {
        if (!slugEditMode) { setSlugCheckState("idle"); return; }
        const slug = slugInput.trim().toLowerCase();
        if (!slug) { setSlugCheckState("idle"); return; }
        if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug)) {
            setSlugCheckState("invalid");
            return;
        }
        setSlugCheckState("checking");
        if (slugDebounceRef.current) clearTimeout(slugDebounceRef.current);
        slugDebounceRef.current = setTimeout(async () => {
            try {
                const result = await checkSlugAvailability(slug);
                setSlugCheckState(result.available ? "available" : "taken");
            } catch {
                setSlugCheckState("idle");
            }
        }, 450);
        return () => { if (slugDebounceRef.current) clearTimeout(slugDebounceRef.current); };
    }, [slugInput, slugEditMode]);

    const handlePublish = useCallback(async () => {
        if (!token) return;
        setPublishState("loading");
        const activeId = previewSnapshots.find((s) => s.isActive)?.id ?? null;
        const notifId = addNotification({
            label: "Pubblicazione",
            status: "running",
            message: "Pubblicazione in corso…",
        });
        try {
            // Never pass selectedBackendSnapshotId here — the user may have browsed to an
            // old version without "applying" it, which would republish the wrong snapshot.
            // Always publish whatever snapshot is marked isActive in the DB (no snapshotId
            // param → backend calls getActiveForProject()). If the user wants to publish a
            // specific version they must first "Applica" it in the history panel.
            const deployment = await publishProject(token, projectId, undefined);
            setPublishDeployment(deployment);
            setPublishState("idle");
            const vn = (() => {
                if (!activeId) return null;
                const idx = previewSnapshots.findIndex((s) => s.id === activeId);
                return idx === -1 ? null : previewSnapshots.length - idx;
            })();
            updateNotification(notifId, {
                status: "done",
                message: vn ? `Pubblicato! (v${vn} attiva)` : "Pubblicato!",
            });
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
                setPublishState("idle");
                updateNotification(notifId, { status: "error", message: "Sessione scaduta" });
                return;
            }
            setPublishState("error");
            const msg = err instanceof Error ? err.message : "Errore pubblicazione";
            updateNotification(notifId, { status: "error", message: msg });
            window.setTimeout(() => setPublishState("idle"), 3000);
        }
    }, [token, projectId, previewSnapshots, addNotification, updateNotification]);

    const handleUnpublish = useCallback(async () => {
        if (!token || !publishDeployment) return;
        setPublishState("loading");
        try {
            await unpublishProject(token, projectId, publishDeployment.id);
            setPublishDeployment(null);
            setPublishState("idle");
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
                setPublishState("idle");
                return;
            }
            setPublishState("error");
            window.setTimeout(() => setPublishState("idle"), 3000);
        }
    }, [token, projectId, publishDeployment]);

    const handleCopyPublishLink = useCallback(() => {
        if (!publishDeployment) return;
        const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
        // Prefer subdomain URL when set (human-readable), fall back to path URL
        const link = publishDeployment.subdomainUrl ?? `${baseUrl}/p/${publishDeployment.publishId}`;
        navigator.clipboard.writeText(link).then(() => {
            setPublishCopied(true);
            window.setTimeout(() => setPublishCopied(false), 2000);
        });
    }, [publishDeployment]);

    const handleSlugSave = useCallback(async () => {
        if (!token || !publishDeployment) return;
        const trimmed = slugInput.trim().toLowerCase();
        const newSlug = trimmed || null;
        setSlugSaving(true);
        try {
            const updated = await updateDeploymentSlug(token, projectId, newSlug);
            setPublishDeployment(updated);
            setSlugEditMode(false);
            setSlugInput("");
            setSlugCheckState("idle");
        } catch {
            // error visible via slugCheckState — leave input open
        } finally {
            setSlugSaving(false);
        }
    }, [token, projectId, slugInput, publishDeployment]);

    const handleSavePromptConfig = useCallback(async () => {
        if (!token) return;
        setIsSavingPrompt(true);
        try {
            const r = await setLlmPromptConfig(token, projectId, {
                enabled: promptEnabled,
                responseFormatVersion: promptConfigVersion,
                prePromptTemplate: promptTemplate,
            });
            setPromptConfigVersion(r.config.responseFormatVersion);
            setPromptTemplate(r.config.prePromptTemplate);
            setPromptEnabled(r.config.enabled);
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
            }
        } finally {
            setIsSavingPrompt(false);
        }
    }, [token, projectId, promptTemplate, promptEnabled, promptConfigVersion]);

    const loadPromptPreview = useCallback(async () => {
        if (!token) return;
        setLoadingPromptPreview(true);
        try {
            const data = await getLlmPromptPreview(token, projectId);
            setPromptPreview(data);
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
            }
        } finally {
            setLoadingPromptPreview(false);
        }
    }, [token, projectId]);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const thinkingFlowRef = useRef<HTMLDivElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const [isUserScrolled, setIsUserScrolled] = useState(false);

    useEffect(() => {
        const t = getToken();
        if (!t) {
            router.replace("/login");
            return;
        }
        setToken(t);
        setCheckingAuth(false);

        // Load project name and preset
        void getProject(t, projectId).then((r) => {
            setProjectName(r.project.name);
            setProjectPresetId(r.project.presetId);
        }).catch(() => {});

        // Load preset catalog (public, no token needed)
        void getPresets().then((r) => setPresetCatalog(r.presets)).catch(() => {});

        const savedSplit = Number(getCookie(SPLIT_COOKIE));
        if (savedSplit >= 25 && savedSplit <= 60) {
            setLeftWidth(savedSplit);
        }
    }, [router]);

    const loadProjectConversation = useCallback(
        async (t: string) => {
            setConversationLoading(true);
            try {
                const res = await getOrCreateProjectConversation(t, projectId);
                setActiveConv(res.conversation);
                setActiveConvId(res.conversation.id);
            } catch (err) {
                setError(err instanceof ApiError ? String(err.message) : "Errore caricamento conversazione");
            } finally {
                setConversationLoading(false);
            }
        },
        [projectId]
    );

    useEffect(() => {
        if (!token) return;
        void loadProjectConversation(token);
        void getLlmProviders(token)
            .then((r) => {
                const providers = r.providers.filter((p) => p.isActive);
                setProvidersCatalog(providers);

                const defaultProvider = providers.find((p) => p.provider === r.activeProvider) ?? providers[0];
                if (!defaultProvider) {
                    setSelectedProvider("");
                    setSelectedModel("");
                    return;
                }

                setSelectedProvider(defaultProvider.provider);
                const defaultModel =
                    defaultProvider.models.find((m) => m.isActive && m.isDefault && m.role === "dialogue") ??
                    defaultProvider.models.find((m) => m.isActive && m.isDefault) ??
                    defaultProvider.models.find((m) => m.isActive);
                setSelectedModel(defaultModel?.id ?? "");
            })
            .catch(() => {
                setProvidersCatalog([]);
            });
        void getLlmPromptConfig(token, projectId)
            .then((r) => {
                setPromptConfigVersion(r.config.responseFormatVersion);
                setPromptTemplate(r.config.prePromptTemplate);
                setPromptEnabled(r.config.enabled);
                if (r.config.chatDefaults) {
                    setChatDefaults(r.config.chatDefaults);
                }
            })
            .catch(() => undefined);
    }, [token, loadProjectConversation, projectId]);

    useEffect(() => {
        if (!selectedProvider) return;
        const provider = providersCatalog.find((p) => p.provider === selectedProvider);
        if (!provider) return;

        const selectedStillValid = provider.models.some((m) => m.isActive && m.id === selectedModel);
        if (selectedStillValid) return;

        const nextModel =
            provider.models.find((m) => m.isActive && m.isDefault && m.role === "dialogue") ??
            provider.models.find((m) => m.isActive && m.isDefault) ??
            provider.models.find((m) => m.isActive);
        setSelectedModel(nextModel?.id ?? "");
    }, [selectedProvider, selectedModel, providersCatalog]);

    // Auto-load prompt preview when user opens the prompt tab
    useEffect(() => {
        if (previewTab === "prompt" && token && !promptPreview && !loadingPromptPreview) {
            void loadPromptPreview();
        }
    }, [previewTab, token, promptPreview, loadingPromptPreview, loadPromptPreview]);

    // Track user scroll: if near bottom → auto-scroll active, else show "go to bottom" button
    useEffect(() => {
        const el = chatContainerRef.current;
        if (!el) return;
        function onScroll() {
            if (!el) return;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            setIsUserScrolled(!atBottom);
        }
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => el.removeEventListener("scroll", onScroll);
    }, []);

    useEffect(() => {
        if (!isUserScrolled) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [activeConv?.messages, isUserScrolled]);

    useEffect(() => {
        if (sending && !isUserScrolled) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [sending, thinkingText, draftAnswer, isUserScrolled]);

    useEffect(() => {
        if (!sending) return;
        if (!thinkingFlowRef.current) return;
        thinkingFlowRef.current.scrollTop = thinkingFlowRef.current.scrollHeight;
    }, [sending, thinkingText]);

    const loadSnapshots = useCallback(
        async (t: string) => {
            setLoadingSnapshots(true);
            try {
                const res = await listPreviewSnapshots(t, projectId);
                const active = res.snapshots.find((s) => s.isActive) ?? res.snapshots[0] ?? null;
                // Batch all state in one render to avoid the two-render gap where
                // the iframe remounts with stale/empty editorHtml.
                if (active?.artifacts) {
                    setEditorHtml(active.artifacts.html ?? "");
                    setEditorCss(active.artifacts.css ?? "");
                    setEditorJs(active.artifacts.js ?? "");
                }
                setPreviewSnapshots(res.snapshots);
                setSelectedBackendSnapshotId(active?.id ?? null);
            } catch {
                // silent — snapshots are supplementary
            } finally {
                setLoadingSnapshots(false);
            }
        },
        [projectId]
    );

    useEffect(() => {
        if (!token) {
            setPreviewSnapshots([]);
            setSelectedBackendSnapshotId(null);
            return;
        }
        void loadSnapshots(token);
    }, [token, loadSnapshots]);

    const [isSavingEditorSnapshot, setIsSavingEditorSnapshot] = useState(false);

    const handleSaveEditorSnapshot = useCallback(async () => {
        if (!token || !activeConvId) return;
        setIsSavingEditorSnapshot(true);
        try {
            const result = await createPreviewSnapshot(token, projectId, {
                conversationId: activeConvId,
                artifacts: { html: editorHtml, css: editorCss, js: editorJs },
                metadata: { finishReason: "manual-save" },
                activate: true,
            });
            saveThumbnail(projectId, { html: editorHtml, css: editorCss, js: editorJs });
            incrementSnapCount(projectId);
            await loadSnapshots(token);
            setSelectedBackendSnapshotId(result.snapshot.id);
            addNotification({ label: "Versione salvata dall'editor", status: "done", message: "Snapshot attivato." });
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
            }
        } finally {
            setIsSavingEditorSnapshot(false);
        }
    }, [token, projectId, activeConvId, editorHtml, editorCss, editorJs, loadSnapshots, addNotification]);

    // Receive element selections + EDIT mode messages from the sandboxed preview iframe
    useEffect(() => {
        function onMessage(event: MessageEvent) {
            if (!event.data || typeof event.data !== "object") return;
            if (event.data.type === "pf-select") {
                setSelectedElement(event.data.element as LlmFocusContext["selectedElement"]);
                return;
            }
            if (event.data.type === "pf-edit-save") {
                // Triggered when user confirms save from EDIT Light mode
                const html = String(event.data.html ?? "");
                pendingEditHtmlRef.current = html;
                void handleCommitEditVersionRef.current(html);
            }
        }
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, []);

    // Propagate inspect mode toggles to the iframe via postMessage
    useEffect(() => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        win.postMessage({ type: "pf-inspect", on: inspectMode }, "*");
    }, [inspectMode]);

    // Propagate EDIT mode to the iframe via postMessage
    useEffect(() => {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        win.postMessage({ type: "pf-edit", on: editMode }, "*");
    }, [editMode]);

    /**
     * Toggle EDIT Light mode.
     * When activating: creates (or resumes) a WysiwygEditSession on the backend
     * so that crash-recovery and history are persisted from the first interaction.
     */
    const handleToggleEditMode = useCallback(async () => {
        if (!token || !activeConvId) return;
        const next = !editMode;
        setEditMode(next);

        if (!next) {
            // Turning OFF — cancel any pending autosave
            if (editAutosaveTimerRef.current) {
                clearTimeout(editAutosaveTimerRef.current);
                editAutosaveTimerRef.current = null;
            }
            return;
        }

        // Turning ON — ensure a backend session exists
        try {
            const snapshotId = selectedBackendSnapshotId;
            if (!snapshotId) return;
            const res = await createWysiwygEditSession(token, projectId, {
                conversationId: activeConvId,
                originSnapshotId: snapshotId,
                currentHtml: editorHtml,
                currentCss: editorCss,
                currentJs: editorJs,
            });
            setEditSessionId(res.session.id);
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
            }
            // Non-blocking: EDIT Light still works without a backend session (degraded mode)
        }
    }, [token, activeConvId, editMode, selectedBackendSnapshotId, projectId, editorHtml, editorCss, editorJs]);

    /**
     * Trigger the iframe to serialize the current edited DOM, then receive it
     * back via pf-edit-save postMessage to commit as a new snapshot version.
     */
    const handleTriggerEditSave = useCallback(() => {
        iframeRef.current?.contentWindow?.postMessage({ type: "pf-edit-trigger-save" }, "*");
    }, []);

    /**
     * Called after receiving pf-edit-save from the iframe.
     * Creates a new PreviewSnapshot with finishReason='wysiwyg-edit-light'.
     */
    const handleCommitEditVersion = useCallback(async (html: string) => {
        if (!token || !activeConvId) return;
        setIsSavingEditVersion(true);
        try {
            if (editSessionId) {
                // Autosave current state first, then commit via session
                await saveWysiwygEditState(token, projectId, editSessionId, {
                    html,
                    css: editorCss,
                    js: editorJs,
                });
                const res = await commitWysiwygSession(token, projectId, editSessionId, {
                    description: "EDIT Light",
                });
                saveThumbnail(projectId, { html, css: editorCss, js: editorJs });
                incrementSnapCount(projectId);
                await loadSnapshots(token);
                setSelectedBackendSnapshotId(res.snapshot.id);
                setEditSessionId(null);
            } else {
                // Degraded mode: session was not created, save directly as PreviewSnapshot
                const res = await createPreviewSnapshot(token, projectId, {
                    conversationId: activeConvId,
                    artifacts: { html, css: editorCss, js: editorJs },
                    metadata: { finishReason: "wysiwyg-edit-light" },
                    activate: true,
                });
                saveThumbnail(projectId, { html, css: editorCss, js: editorJs });
                incrementSnapCount(projectId);
                await loadSnapshots(token);
                setSelectedBackendSnapshotId(res.snapshot.id);
            }
            addNotification({ label: "Versione EDIT salvata", status: "done", message: "Modifiche manuali versionate." });
            setEditMode(false);
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
            }
        } finally {
            setIsSavingEditVersion(false);
        }
    }, [token, projectId, activeConvId, editSessionId, editorCss, editorJs, loadSnapshots, addNotification]);
    handleCommitEditVersionRef.current = handleCommitEditVersion;

    // ── Derived values ──────────────────────────────────────────────────────
    // Computed BEFORE hooks that depend on them
    // and before early-return guard so handleSend can access them via closure.

    const assistantSnapshots = (activeConv?.messages ?? [])
        .filter((m) => m.role === "assistant" && m.metadata?.generatedArtifacts)
        .slice()
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const latestAssistant = (activeConv?.messages ?? [])
        .slice()
        .reverse()
        .find((m) => m.role === "assistant");

    // Active baseline: the snapshot marked isActive (used as LLM context on next turn).
    // If the active snapshot has empty HTML (corrupted), fall back to the first
    // snapshot with actual content to prevent sending blank context to the LLM.
    const activeMarked = previewSnapshots.find((s) => s.isActive);

    // Published version tracking — for the Live banner stale warning.
    const publishedSnapshotIdx = publishDeployment
        ? previewSnapshots.findIndex((s) => s.id === publishDeployment.snapshotId)
        : -1;
    const publishedVersionNumber = publishedSnapshotIdx !== -1
        ? previewSnapshots.length - publishedSnapshotIdx
        : null;
    const activeMarkedIdx = previewSnapshots.findIndex((s) => s.isActive);
    const activeVersionNumber = activeMarkedIdx !== -1 ? previewSnapshots.length - activeMarkedIdx : null;
    const isPublishStale =
        publishDeployment?.status === "live" &&
        !!activeMarked &&
        publishDeployment.snapshotId !== activeMarked.id;

    const activeBaselineSnapshot =
        (activeMarked && activeMarked.artifacts?.html ? activeMarked : null) ??
        previewSnapshots.find((s) => !!s.artifacts?.html) ??
        previewSnapshots[0] ??
        null;

    // Selected snapshot: the one currently displayed in the preview panel
    const selectedBackendSnapshot =
        previewSnapshots.find((s) => s.id === selectedBackendSnapshotId) ?? activeBaselineSnapshot;

    const artifacts =
        selectedBackendSnapshot?.artifacts ?? latestAssistant?.metadata?.generatedArtifacts;

    const artifactsKey = selectedBackendSnapshot?.id ?? latestAssistant?.id ?? "no-artifacts";

    useEffect(() => {
        setEditorHtml(artifacts?.html ?? "");
        setEditorCss(artifacts?.css ?? "");
        setEditorJs(artifacts?.js ?? "");
        setEditorSelectionLabel("Nessuna selezione");
        setCodeEditorSelection(null);
        // Clear the selected element when the active snapshot changes.
        // data-pf-id values are snapshot-version-specific: if the snapshot HTML was
        // rebuilt or a focused patch replaced the root element, the element gets a new
        // ID. Keeping the old outerHtml (with the stale ID) would make Strategy 0 fail
        // on the next focused-edit turn because the ID is no longer present in the base.
        setSelectedElement(null);
    }, [artifactsKey, artifacts?.html, artifacts?.css, artifacts?.js]);

    // Watchdog: if the iframe key changes but onLoad never fires within 4 s
    // (browser bug, blank srcDoc race), bump previewForceKey to force a new mount.
    useEffect(() => {
        if (artifactsKey === "no-artifacts") return;
        iframeLoadedRef.current = false;
        const watchdog = setTimeout(() => {
            if (!iframeLoadedRef.current) {
                setPreviewForceKey((k) => k + 1);
            }
        }, 4000);
        return () => clearTimeout(watchdog);
    }, [artifactsKey]); // intentionally omits previewDocWithInspect to avoid running on every keystroke

    const liveGeneratedTokens = Math.max(0, Math.round((thinkingText.length + draftAnswer.length) / 4));
    const liveTotalTokens = streamPromptTokens + liveGeneratedTokens;
    const currentProvider = providersCatalog.find((p) => p.provider === selectedProvider) ?? null;
    const currentProviderModels = (() => {
        const models = (currentProvider?.models ?? []).filter((m) => m.isActive);
        const byId = new Map<string, typeof models[number]>();
        for (const model of models) {
            if (!byId.has(model.id) || model.isDefault) {
                byId.set(model.id, model);
            }
        }
        return [...byId.values()];
    })();

        const previewResult = editorHtml || editorCss || editorJs
        ? buildPreviewDoc(
                        editorHtml,
                        editorCss,
                        editorJs
          )
        : null;
    const previewDoc = previewResult?.doc ?? "";
    const previewQuality = previewResult?.quality ?? "none";

    // Inject inspect infrastructure script so the iframe is always ready to receive postMessages.
    // When EDIT mode is active, also inject PF_EDIT_SCRIPT for contentEditable WYSIWYG.
    const previewDocWithInspect = previewDoc
        ? (() => {
               const scripts = PF_INSPECT_SCRIPT + (editMode ? PF_EDIT_SCRIPT : "");
               return previewDoc.includes("</body>")
                   ? previewDoc.replace(/<\/body>/i, `${scripts}</body>`)
                   : `${previewDoc}${scripts}`;
          })()
        : "";

    // ── Drag resize ─────────────────────────────────────────────────────────
    useEffect(() => {
        function onMove(e: MouseEvent) {
            if (!isDragging) return;
            const width = window.innerWidth;
            const pct = (e.clientX / width) * 100;
            const clamped = Math.max(25, Math.min(60, pct));
            setLeftWidth(clamped);
        }

        function onUp() {
            if (!isDragging) return;
            setIsDragging(false);
            setCookie(SPLIT_COOKIE, String(Math.round(leftWidth)));
        }

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }, [isDragging, leftWidth]);

    async function handleSend(e: React.FormEvent) {
        e.preventDefault();
        const content = prompt.trim();
        if (!content || !token || sending || conversationLoading) return;

        setPrompt("");
        setSending(true);
        setError(null);
        setThinkingText("");
        setDraftAnswer("");
        setIsUserScrolled(false);
        setStreamPromptTokens(Math.max(1, Math.round(content.length / 4)));
        setStreamUsageTokens(null);

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        let trackedConversationId: string | null = activeConvId;
        let trackedUserMessageId: string | null = null;
        const streamStartedAt = Date.now();
        let streamErrorDurationMs: number | undefined;

        try {
            const convId = activeConvId;
            if (!convId) {
                throw new Error("Conversation not loaded yet");
            }

            const res = await addMessage(token, projectId, convId, {
                role: "user",
                content,
            });
            const userMessageId = res.message.id;
            trackedConversationId = convId;
            trackedUserMessageId = userMessageId;
            setActiveConv((prev) =>
                prev ? { ...prev, messages: [...prev.messages, res.message] } : prev
            );

            if (!convId) {
                throw new Error("Conversation ID not available");
            }

            // Build conversation history sent to the backend.
            // Assistant messages store the raw LLM JSON blob (with full HTML) in content —
            // sending that as history overflows the schema limit and is useless to the model.
            // Use chatStructured.summary instead; fall back to truncated raw content.
            const history = (activeConv?.messages ?? [])
                .filter((m): m is MessageDto & { role: "user" | "assistant" } =>
                    m.role === "user" || m.role === "assistant"
                )
                .map((m) => {
                    if (m.role === "assistant") {
                        const s = m.metadata?.chatStructured;
                        const compact = s
                            ? [s.summary, ...(s.bullets ?? [])].filter(Boolean).join(" | ")
                            : m.content.slice(0, 2000);
                        return { role: "assistant" as const, content: compact };
                    }
                    return { role: "user" as const, content: m.content };
                });

            const currentArtifacts =
                editorHtml || editorCss || editorJs
                    ? { html: editorHtml, css: editorCss, js: editorJs }
                    : activeBaselineSnapshot?.artifacts ?? latestAssistant?.metadata?.generatedArtifacts;

            // Build focusContext from active inspect selection or code editor selection
            const focusContext: LlmFocusContext | undefined = (() => {
                if (inspectMode && selectedElement) {
                    return {
                        mode: "preview-element" as const,
                        targetType: getElementTargetType(selectedElement.tag),
                        userIntent: content,
                        selectedElement,
                    };
                }
                if (codeEditorSelection && previewTab !== "preview") {
                    return {
                        mode: "code-selection" as const,
                        targetType: codeEditorSelection.language,
                        codeSelection: codeEditorSelection,
                    };
                }
                return undefined;
            })();

            let llm: Awaited<ReturnType<typeof llmChatPreview>>;
            let interruptedMeta: Extract<LlmChatStreamEvent, { type: "interrupted" }> | null = null;
            try {
                let streamDone = false;
                let streamResult: Awaited<ReturnType<typeof llmChatPreview>> | null = null;

                await streamLlmChatPreview(
                    token,
                    projectId,
                    {
                        message: content,
                        provider: selectedProvider || undefined,
                        model: selectedModel || undefined,
                        capability: chatDefaults.capability,
                        pipelineRole: chatDefaults.pipelineRole,
                        temperature: chatDefaults.temperature,
                        history,
                        currentArtifacts,
                        focusContext,
                    },
                    (event) => {
                        if (event.type === "thinking") {
                            setThinkingText((prev) => prev + event.content);
                            return;
                        }

                        if (event.type === "answer") {
                            setDraftAnswer((prev) => `${prev}${event.content}`);
                            return;
                        }

                        if (event.type === "done") {
                            streamDone = true;
                            streamResult = event.result;
                            if (event.result.usage) {
                                setStreamUsageTokens(event.result.usage);
                            }
                            return;
                        }

                        if (event.type === "error") {
                            streamErrorDurationMs = event.durationMs;
                            throw new Error(event.message);
                        }

                        if (event.type === "interrupted") {
                            interruptedMeta = event;
                            return;
                        }
                    },
                    abortController.signal
                );

                if (!streamDone || !streamResult) {
                    throw new Error("Stream ended without final payload");
                }

                llm = streamResult;
            } catch (streamErr) {
                // If the user cancelled, save an interrupted record and bail out — don't fall back to non-streaming.
                if (streamErr instanceof Error && streamErr.name === "AbortError") {
                    if (token && convId && interruptedMeta) {
                        try {
                            const saved = await addMessage(token, projectId, convId, {
                                role: "assistant",
                                content: "⏹ Elaborazione interrotta dall'utente",
                                metadata: {
                                    model: interruptedMeta.model,
                                    provider: interruptedMeta.provider,
                                    finishReason: "interrupted",
                                    executionTimeMs: interruptedMeta.durationMs,
                                    tokenUsage: interruptedMeta.usage,
                                    costEstimate: interruptedMeta.costEstimate,
                                },
                            });
                            setActiveConv((prev) =>
                                prev ? { ...prev, messages: [...prev.messages, saved.message] } : prev
                            );
                        } catch {
                            // non-blocking — UI will still clear the stream state
                        }
                    }
                    setThinkingText("");
                    setDraftAnswer("");
                    return;
                }
                llm = await llmChatPreview(token, projectId, {
                    message: content,
                    provider: selectedProvider || undefined,
                    model: selectedModel || undefined,
                    capability: chatDefaults.capability,
                    pipelineRole: chatDefaults.pipelineRole,
                    temperature: chatDefaults.temperature,
                    history,
                    currentArtifacts,
                    focusContext,
                });
            }

            const assistantSaved = await addMessage(token, projectId, convId, {
                role: "assistant",
                content: llm.reply,
                metadata: {
                    model: llm.model,
                    provider: llm.provider,
                    executionTimeMs: llm.durationMs,
                    finishReason: llm.finishReason,
                    rawResponse: llm.rawResponse,
                    structuredParseValid: llm.structuredParseValid,
                    promptingTrace: llm.promptingTrace,
                    tokenUsage: llm.usage,
                    costEstimate: llm.costEstimate,
                    generatedArtifacts: llm.structured?.artifacts,
                    chatStructured: llm.structuredParseValid ? llm.structured?.chat : undefined,
                },
            });

            setActiveConv((prev) =>
                prev ? { ...prev, messages: [...prev.messages, assistantSaved.message] } : prev
            );

            // Persist preview snapshot to DB — only when html is non-empty.
            // In focused-patch mode the LLM returns artifacts:{html:"",…}; the server
            // merges the patch and returns the full HTML. If html is still empty after
            // the merge (anchor not found AND base was empty) we skip snapshot creation
            // to avoid versioning an empty artifact and corrupting the active baseline.
            // Also skip when the server explicitly reports focusPatchApplied === false
            // (anchor not found, fallback returned) to avoid creating no-op versions.
            if (llm.structured?.artifacts && llm.structured.artifacts.html && convId && llm.focusPatchApplied !== false) {
                try {
                    const snap = await createPreviewSnapshot(token, projectId, {
                        conversationId: convId,
                        sourceMessageId: assistantSaved.message.id,
                        artifacts: {
                            html: llm.structured.artifacts.html ?? "",
                            css: llm.structured.artifacts.css ?? "",
                            js: llm.structured.artifacts.js ?? "",
                        },
                        // In focused-patch mode the rawResponse has artifacts.html=""; the
                        // server already merged the patch and returned full HTML via
                        // structured.artifacts. Sending rawResponse here would cause the
                        // snapshot route to overwrite the correct merged HTML with empty.
                        rawLlmResponse: llm.focusPatchApplied ? undefined : (llm.rawResponse ?? undefined),
                        metadata: {
                            model: llm.model,
                            provider: llm.provider,
                            durationMs: llm.durationMs,
                            finishReason: llm.finishReason,
                            structuredParseValid: llm.structuredParseValid,
                            tokenUsage: llm.usage,
                            promptingTrace: llm.promptingTrace,
                        },
                        activate: true,
                    });
                    // Cache thumbnail and prompt excerpt locally for ProjectCard display
                    saveThumbnail(projectId, {
                        html: llm.structured.artifacts.html ?? "",
                        css: llm.structured.artifacts.css ?? "",
                        js: llm.structured.artifacts.js ?? "",
                    });
                    savePromptExcerpt(projectId, llm.promptingTrace?.prePromptTemplate);
                    incrementSnapCount(projectId);

                    // Fetch updated snapshot list inline so we can batch ALL state updates
                    // into ONE React render. If we called loadSnapshots() (which does its own
                    // setSelectedBackendSnapshotId internally), React would fire an intermediate
                    // render where artifactsKey already points to the new snapshot but
                    // editorHtml/Css/Js still hold the old values — causing the iframe to remount
                    // with blank/stale content. By collecting all setStates here in a single
                    // synchronous block React 18 batches them into one render, so the iframe
                    // remounts with the correct srcDoc on the very first attempt.
                    let freshSnapshots: PreviewSnapshot[] = [];
                    try {
                        const res = await listPreviewSnapshots(token, projectId);
                        freshSnapshots = res.snapshots;
                    } catch { /* silent — snapshot list is supplementary */ }

                    // --- single batched render from here ---
                    setPreviewSnapshots(freshSnapshots);
                    setSelectedBackendSnapshotId(snap.snapshot.id);
                    setEditorHtml(llm.structured.artifacts.html ?? "");
                    setEditorCss(llm.structured.artifacts.css ?? "");
                    setEditorJs(llm.structured.artifacts.js ?? "");
                    // Spinner cleared by iframe onLoad; fallback timeout in case user is on another tab
                    setPreviewRefreshing(true);
                    setPreviewPending(true);
                    setTimeout(() => {
                        setPreviewRefreshing(false);
                    }, 3000);
                    // Notify: new snapshot version saved
                    addNotification({
                        label: llm.focusPatchApplied ? "Focus patch applicata" : "Nuova versione salvata",
                        status: "done",
                        message: llm.focusPatchApplied
                            ? "Elemento aggiornato — nuova versione attiva."
                            : "Snapshot salvato e attivato dal backend.",
                    });
                } catch {
                    // non-blocking — UI works without snapshot persistence
                }
            }

            // Inform the user when a focused-patch merge failed on the server.
            // This happens when the element's data-pf-id is stale (e.g. the active
            // snapshot was replaced without the element being re-selected) and all
            // text-matching fallbacks also failed.  The selection is cleared so the
            // next focused-edit starts fresh with a valid anchor.
            if (llm.focusPatchApplied === false && focusContext?.mode === "preview-element") {
                setSelectedElement(null);
                setEditorSelectionLabel("Nessuna selezione");
                addNotification({
                    label: "Focus patch non applicata",
                    status: "error",
                    message: "Elemento non trovato nella versione corrente. Riseleziona l'elemento nel preview e riprova.",
                });
            }

            if (userMessageId) {
                await logBackgroundTask(token, projectId, convId, userMessageId, {
                    type: "llm_chat_preview",
                    pipelineProfile: llm.simulated ? "preview-simulated" : "preview-live",
                    input: { prompt: content, role: "dialogue", responseFormatVersion: promptConfigVersion },
                    output: {
                        provider: llm.provider,
                        model: llm.model,
                        durationMs: llm.durationMs,
                        simulated: llm.simulated,
                        hasArtifacts: Boolean(llm.structured?.artifacts),
                            estimatedCost: llm.costEstimate,
                    },
                        tokenUsage: llm.usage,
                        costEstimate: llm.costEstimate,
                    status: "completed",
                });
            }

            setThinkingText("");
            setDraftAnswer("");
        } catch (err) {
            const msg = err instanceof ApiError ? `Errore [${err.status}]: ${err.message}` : String(err);
            setError(msg);

            if (token && trackedConversationId) {
                try {
                    const errorSaved = await addMessage(token, projectId, trackedConversationId, {
                        role: "error",
                        content: msg,
                    });

                    setActiveConv((prev) =>
                        prev ? { ...prev, messages: [...prev.messages, errorSaved.message] } : prev
                    );
                } catch {
                    // keep initial error
                }
            }

            if (token && trackedConversationId && trackedUserMessageId) {
                try {
                    await logBackgroundTask(token, projectId, trackedConversationId, trackedUserMessageId, {
                        type: "llm_chat_preview",
                        pipelineProfile: "preview-live",
                        input: { prompt: content, role: "dialogue", responseFormatVersion: promptConfigVersion },
                        output: { durationMs: streamErrorDurationMs ?? (Date.now() - streamStartedAt) },
                        error: msg,
                        status: "failed",
                    });
                } catch {
                    // keep initial error
                }
            }
        } finally {
            abortControllerRef.current = null;
            setSending(false);
        }
    }

    function handleStop() {
        abortControllerRef.current?.abort();
    }

    if (checkingAuth) {
        return <div style={{ padding: "2rem", color: "var(--text-muted)" }}>Verifica sessione…</div>;
    }

    return (
        <>
        <div
            className="workspace-shell workspace-shell-resizable"
            style={{ gridTemplateColumns: `${leftWidth}% 8px minmax(0, 1fr)` }}
        >
            <aside className="workspace-chat-panel">
                <div className="workspace-chat-header">
                    {/* Project name + cog */}
                    <div className="row" style={{ gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
                        <span style={{ flex: 1, fontSize: "0.92rem", fontWeight: 700, color: "var(--text-foreground, #fff)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {projectName || "…"}
                        </span>
                        <button
                            onClick={() => setConfigOpen(true)}
                            title="Configura progetto"
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0.15rem", display: "flex", alignItems: "center", opacity: 0.7 }}
                        >
                            <Settings size={15} />
                        </button>
                    </div>
                    <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                            Chat di Progetto
                        </span>
                        {(() => {
                            const projectCost = activeConv?.totalCost ?? 0;
                            const label = formatCostEur(projectCost);
                            return label ? (
                                <span style={{
                                    fontSize: "0.68rem",
                                    background: "var(--surface-2, rgba(255,255,255,0.07))",
                                    border: "1px solid var(--border-subtle, rgba(255,255,255,0.14))",
                                    borderRadius: "0.3rem",
                                    padding: "0.05rem 0.4rem",
                                    color: "var(--text-muted)",
                                    fontVariantNumeric: "tabular-nums",
                                }} title="Costo stimato totale progetto (policy EUR)">
                                    tot ~{label}
                                </span>
                            ) : null;
                        })()}
                        <select
                            style={controlSelectStyle}
                            value={selectedProvider}
                            onChange={(e) => setSelectedProvider(e.target.value)}
                            disabled={providersCatalog.length === 0 || sending}
                        >
                            {providersCatalog.length === 0 ? (
                                <option value="">Provider</option>
                            ) : (
                                providersCatalog.map((p) => (
                                    <option key={p.provider} value={p.provider}>
                                        {p.provider}
                                    </option>
                                ))
                            )}
                        </select>
                        <select
                            style={controlSelectStyle}
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            disabled={!currentProvider || currentProviderModels.length === 0 || sending}
                        >
                            {currentProviderModels.length === 0 ? (
                                <option value="">Model</option>
                            ) : (
                                groupedModelOptions(currentProviderModels)
                            )}
                        </select>
                    </div>
                </div>

                <div className="workspace-chat-messages" ref={chatContainerRef}>
                    {conversationLoading && (
                        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", padding: "0.5rem" }}>
                            Caricamento conversazione…
                        </p>
                    )}
                    {activeConv?.messages.map((msg) => (
                        <MessageBubble key={msg.id} message={msg} />
                    ))}

                    {sending && (
                        <div className="workspace-stream-box">
                            <div className="workspace-stream-title">
                                {draftAnswer ? "Risposta in corso..." : thinkingText ? "Ragionamento..." : "Connessione al provider..."}
                            </div>
                            <div ref={thinkingFlowRef} className="workspace-thinking-flow">
                                {thinkingText || "In attesa del ragionamento stream..."}
                            </div>
                            {draftAnswer && (
                                <div className="workspace-draft-box">
                                    <pre className="workspace-draft-inner">{draftAnswer}</pre>
                                </div>
                            )}
                            <div className="workspace-stream-footer">
                                <div className="workspace-thinking-spinner">
                                    <span className="workspace-spinner-dot" />
                                    sto pensando...
                                </div>
                                <div className="workspace-token-counter">
                                    {streamUsageTokens
                                        ? `${streamUsageTokens.completionTokens.toLocaleString()} tok gen · ${streamUsageTokens.totalTokens.toLocaleString()} tok`
                                        : `~${liveGeneratedTokens.toLocaleString()} tok gen · ~${liveTotalTokens.toLocaleString()} tok`}
                                </div>
                            </div>
                        </div>
                    )}

                    {!activeConv && (
                        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "0.4rem 0.2rem" }}>
                            Apri una conversazione o invia un nuovo prompt.
                        </p>
                    )}
                    {error && <div className="status error">{error}</div>}
                    <div ref={messagesEndRef} />
                    {isUserScrolled && (
                        <button
                            className="chat-scroll-to-bottom"
                            onClick={() => {
                                setIsUserScrolled(false);
                                messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                            }}
                            aria-label="Torna in fondo alla chat"
                            title="Torna in fondo"
                        >
                            ↓
                        </button>
                    )}
                </div>

                <form onSubmit={(e) => void handleSend(e)} className="workspace-input-form">
                    <textarea
                        style={textareaStyle}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void handleSend(e as unknown as React.FormEvent);
                            }
                        }}
                        placeholder="Scrivi cosa vuoi realizzare..."
                        rows={3}
                        disabled={sending}
                    />
                    {/* Focus context indicator */}
                    {(inspectMode && selectedElement) && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.76rem", color: "var(--accent-text, #818cf8)", padding: "0.2rem 0" }}>
                            <span style={{ opacity: 0.7 }}>◎</span>
                            <span>Elemento: <strong>{selectedElement.selector}</strong>
                                {selectedElement.tag !== selectedElement.selector.replace(/^#.+|^\..+/, "") && (
                                    <span style={{ color: "var(--text-muted)", marginLeft: "0.3rem" }}>&lt;{selectedElement.tag}&gt;</span>
                                )}
                            </span>
                            <button
                                type="button"
                                style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius)", cursor: "pointer", color: "var(--text-muted)", fontSize: "0.7rem", padding: "0.1rem 0.4rem" }}
                                onClick={async () => {
                                    await copyTextToClipboard(JSON.stringify(selectedElement, null, 2));
                                }}
                                title="Copia JSON metadati elemento selezionato"
                            >Copia JSON</button>
                            <button
                                type="button"
                                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "0.9rem", lineHeight: 1 }}
                                onClick={() => setSelectedElement(null)}
                                title="Rimuovi selezione elemento"
                            >×</button>
                        </div>
                    )}
                    {(!inspectMode || !selectedElement) && codeEditorSelection && previewTab !== "preview" && (
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.76rem", color: "var(--accent-text, #818cf8)", padding: "0.2rem 0" }}>
                            <span style={{ opacity: 0.7 }}>📝</span>
                            <span>{codeEditorSelection.language.toUpperCase()} righe {codeEditorSelection.startLine}–{codeEditorSelection.endLine}</span>
                            <button
                                type="button"
                                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "0.9rem", lineHeight: 1 }}
                                onClick={() => setCodeEditorSelection(null)}
                                title="Rimuovi selezione codice"
                            >×</button>
                        </div>
                    )}
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <div className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
                            <button className="secondary" type="button" onClick={() => router.push("/dashboard")}>← Dashboard</button>
                            <RequestMetaInfo message={latestAssistant} variant="global" />
                        </div>
                        <div className="row" style={{ gap: "0.5rem" }}>
                            {sending && (
                                <button
                                    type="button"
                                    className="secondary"
                                    onClick={handleStop}
                                    style={{ color: "var(--error, #f87171)", borderColor: "var(--error, #f87171)" }}
                                    title="Interrompi la generazione in corso"
                                >
                                    ⏹ Stop
                                </button>
                            )}
                            <button type="submit" disabled={!prompt.trim() || sending || conversationLoading}>{sending ? "Invio..." : "Invia"}</button>
                        </div>
                    </div>
                </form>
            </aside>

            <div
                className="workspace-resizer"
                onMouseDown={() => setIsDragging(true)}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize panels"
            />

            <section className="workspace-preview-panel">
                <div className="workspace-preview-header">
                    <span style={{ fontWeight: 700 }}>{activeConv ? activeConv.title : "Preview"}</span>
                    <div className="row" style={{ gap: "0.4rem" }}>
                        <span className="badge purple">format {promptConfigVersion}</span>
                        {(selectedBackendSnapshot?.metadata?.provider ?? latestAssistant?.metadata?.provider) && (
                            <span className="badge purple">
                                {selectedBackendSnapshot?.metadata?.provider ?? latestAssistant?.metadata?.provider}
                            </span>
                        )}
                        {(selectedBackendSnapshot?.metadata?.model ?? latestAssistant?.metadata?.model) && (
                            <span className="badge purple">
                                {selectedBackendSnapshot?.metadata?.model ?? latestAssistant?.metadata?.model}
                            </span>
                        )}
                        {previewQuality !== "none" && (
                            <span className={`badge ${previewQuality === "clean" ? "green" : previewQuality === "injected" ? "yellow" : "orange"}`}>
                                {previewQuality}
                            </span>
                        )}
                    </div>
                </div>

                <div className="workspace-preview-tabs" style={{ gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap", marginLeft: "auto" }}>
                        {(previewSnapshots.length > 0 || loadingSnapshots) && (
                            <SnapshotHistoryPanel
                                snapshots={previewSnapshots}
                                selectedId={selectedBackendSnapshotId}
                                loading={loadingSnapshots}
                                onSelect={(id) => {
                                    // Batch: pre-populate editor state in the same render so the
                                    // iframe remounts with correct content, not a stale/blank doc.
                                    const snap = previewSnapshots.find((s) => s.id === id);
                                    if (snap?.artifacts) {
                                        setEditorHtml(snap.artifacts.html ?? "");
                                        setEditorCss(snap.artifacts.css ?? "");
                                        setEditorJs(snap.artifacts.js ?? "");
                                    }
                                    setSelectedBackendSnapshotId(id);
                                    setPreviewRefreshing(true);
                                }}
                                onActivate={async (id) => {
                                    if (!token) return;
                                    try {
                                        await activatePreviewSnapshot(token, projectId, id);
                                        const snap = previewSnapshots.find((s) => s.id === id);
                                        if (snap?.artifacts) {
                                            setEditorHtml(snap.artifacts.html ?? "");
                                            setEditorCss(snap.artifacts.css ?? "");
                                            setEditorJs(snap.artifacts.js ?? "");
                                        }
                                        setSelectedBackendSnapshotId(id);
                                        setPreviewRefreshing(true);
                                        await loadSnapshots(token);
                                        addNotification({ label: "Versione attivata", status: "done", message: "Snapshot selezionato come versione attiva." });
                                    } catch { /* silent */ }
                                }}
                                onDelete={async (id) => {
                                    if (!token) return;
                                    await deletePreviewSnapshot(token, projectId, id);
                                    await loadSnapshots(token);
                                }}
                                onRecover={() => {
                                    const active = previewSnapshots.find((s) => s.isActive) ?? previewSnapshots[0];
                                    if (active) {
                                        if (active.artifacts) {
                                            setEditorHtml(active.artifacts.html ?? "");
                                            setEditorCss(active.artifacts.css ?? "");
                                            setEditorJs(active.artifacts.js ?? "");
                                        }
                                        setSelectedBackendSnapshotId(active.id);
                                        setPreviewRefreshing(true);
                                    }
                                }}
                            />
                        )}
                    </div>
                </div>

                <div className="workspace-preview-tabs">
                    {(["preview", "html", "css", "js"] as const).map((tab) => (
                        <button
                            key={tab}
                            className="secondary"
                            data-active={previewTab === tab ? "true" : "false"}
                            onClick={() => {
                                setPreviewTab(tab);
                                if (tab === "preview") setPreviewPending(false);
                            }}
                            type="button"
                            style={{ position: "relative" }}
                        >
                            {tab.toUpperCase()}
                            {tab === "preview" && previewPending && previewTab !== "preview" && (
                                <span
                                    style={{
                                        position: "absolute",
                                        top: 3,
                                        right: 3,
                                        width: 7,
                                        height: 7,
                                        borderRadius: "50%",
                                        background: "#22d3ee",
                                        boxShadow: "0 0 5px #22d3ee",
                                        animation: "pf-pulse 1.2s ease-in-out infinite",
                                        display: "block",
                                    }}
                                />
                            )}
                        </button>
                    ))}

                    {/* Prompt preview tab */}
                    <button
                        type="button"
                        className="secondary"
                        data-active={previewTab === "prompt" ? "true" : "false"}
                        onClick={() => setPreviewTab("prompt")}
                        title="Visualizza il system prompt composto passato all'LLM (sola lettura)"
                    >
                        🔍 PROMPT
                    </button>



                    {previewTab === "preview" && (
                        <>
                            <button
                                type="button"
                                className="secondary"
                                data-active={inspectMode ? "true" : "false"}
                                onClick={() => {
                                    const next = !inspectMode;
                                    setInspectMode(next);
                                    if (!next) setSelectedElement(null);
                                    // Disable EDIT mode when Inspect is activated
                                    if (next && editMode) setEditMode(false);
                                }}
                                style={{ marginLeft: "auto", fontSize: "0.74rem", padding: "0.2rem 0.6rem" }}
                                title={inspectMode ? "Disattiva Inspect" : "Attiva Inspect: clicca elementi nella preview per selezionarli"}
                            >
                                {inspectMode ? "◎ Inspect ON" : "◎ Inspect"}
                            </button>
                            {/* EDIT Light toggle — only when there are artifacts */}
                            {artifacts && !inspectMode && (
                                <button
                                    type="button"
                                    className="secondary"
                                    data-active={editMode ? "true" : "false"}
                                    onClick={() => void handleToggleEditMode()}
                                    style={{ fontSize: "0.74rem", padding: "0.2rem 0.6rem" }}
                                    title={editMode ? "Disattiva EDIT Light" : "Attiva EDIT Light: clicca testo o immagini per modificarli direttamente"}
                                >
                                    {editMode ? "✎ EDIT ON" : "✎ EDIT"}
                                </button>
                            )}
                            {/* Save as version button — only when EDIT Light is active */}
                            {editMode && (
                                <button
                                    type="button"
                                    className="primary"
                                    disabled={isSavingEditVersion}
                                    onClick={handleTriggerEditSave}
                                    style={{ fontSize: "0.74rem", padding: "0.2rem 0.7rem" }}
                                    title="Salva le modifiche EDIT come nuova versione dell'artefatto"
                                >
                                    {isSavingEditVersion ? "⏳ Salvataggio…" : "💾 Salva EDIT"}
                                </button>
                            )}
                        </>
                    )}

                    {previewTab !== "preview" && (
                        <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: "0.75rem" }}>
                            {editorSelectionLabel}
                        </span>
                    )}

                    {/* Export ZIP button — always visible when artifacts exist */}
                    {artifacts && (
                        <button
                            type="button"
                            className="secondary"
                            disabled={exportState === "loading"}
                            onClick={handleExportLayer1}
                            style={{ fontSize: "0.74rem", padding: "0.2rem 0.6rem", marginLeft: "0.5rem" }}
                            title={exportState === "error" ? (exportError ?? "Errore export") : "Esporta HTML/CSS/JS come ZIP"}
                        >
                            {exportState === "loading" ? "⏳ Export…" : "⬇ Esporta ZIP"}
                        </button>
                    )}

                    {/* Camera snapshot button — JPG / PDF capture of the live preview */}
                    {artifacts && (
                        <div ref={captureDropdownRef} style={{ position: "relative", marginLeft: "0.3rem" }}>
                            <button
                                type="button"
                                className="secondary"
                                disabled={captureState === "loading"}
                                onClick={() => setCaptureDropdownOpen((v) => !v)}
                                style={{ fontSize: "0.74rem", padding: "0.2rem 0.6rem" }}
                                title="Cattura screenshot JPG o PDF della preview"
                            >
                                {captureState === "loading"
                                    ? "⏳ Cattura…"
                                    : captureState === "error"
                                    ? "⚠ Errore"
                                    : "📷 Cattura"}
                            </button>
                            {captureDropdownOpen && (
                                <div
                                    style={{
                                        position: "absolute",
                                        top: "calc(100% + 4px)",
                                        right: 0,
                                        zIndex: 300,
                                        background: "var(--surface)",
                                        border: "1px solid var(--border)",
                                        borderRadius: "var(--radius)",
                                        boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
                                        minWidth: 150,
                                        overflow: "hidden",
                                    }}
                                >
                                    {(["jpg", "pdf"] as const).map((fmt) => (
                                        <button
                                            key={fmt}
                                            type="button"
                                            onClick={() => void handleCaptureSnapshot(fmt)}
                                            style={{
                                                display: "block",
                                                width: "100%",
                                                background: "transparent",
                                                border: "none",
                                                borderBottom: fmt === "jpg" ? "1px solid var(--border)" : "none",
                                                color: "var(--text)",
                                                padding: "0.55rem 0.9rem",
                                                textAlign: "left",
                                                cursor: "pointer",
                                                fontSize: "0.82rem",
                                            }}
                                            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                                        >
                                            {fmt === "jpg" ? "🖼 Download JPG" : "📄 Download PDF"}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Publish button */}
                    {artifacts && (
                        <button
                            type="button"
                            className="secondary"
                            disabled={publishState === "loading"}
                            onClick={handlePublish}
                            style={{ fontSize: "0.74rem", padding: "0.2rem 0.6rem", marginLeft: "0.3rem" }}
                            title={publishDeployment ? "Aggiorna pubblicazione live" : "Pubblica con link condivisibile"}
                        >
                            {publishState === "loading"
                                ? "⏳ Pubblica…"
                                : publishState === "error"
                                ? "⚠ Errore"
                                : publishDeployment
                                ? "🔄 Aggiorna"
                                : "🌐 Pubblica"}
                        </button>
                    )}
                </div>

                {/* Published banner — shown when a live deployment exists */}
                {publishDeployment && publishDeployment.status === "live" && (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.25rem",
                            padding: "0.3rem 0.7rem",
                            background: isPublishStale ? "rgba(245,158,11,0.07)" : "rgba(34,211,238,0.08)",
                            borderBottom: isPublishStale ? "1px solid rgba(245,158,11,0.25)" : "1px solid rgba(34,211,238,0.20)",
                            fontSize: "0.78rem",
                            color: "#22d3ee",
                        }}
                    >
                        {/* Row 1: live badge + links + actions */}
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 600 }}>🌐 Live</span>
                            {publishedVersionNumber != null && (
                                <span style={{ fontSize: "0.72rem", opacity: 0.75, fontVariantNumeric: "tabular-nums" }}>
                                    (v{publishedVersionNumber})
                                </span>
                            )}
                            {/* Subdomain URL (primary) */}
                            {publishDeployment.subdomainUrl ? (
                                <a
                                    href={publishDeployment.subdomainUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: "#22d3ee", textDecoration: "underline" }}
                                >
                                    {publishDeployment.customSlug
                                        ? publishDeployment.customSlug
                                        : publishDeployment.subdomainUrl}
                                </a>
                            ) : null}
                            {/* Path URL (secondary / always shown) */}
                            <a
                                href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/p/${publishDeployment.publishId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: "#22d3ee", textDecoration: "underline", opacity: publishDeployment.subdomainUrl ? 0.6 : 1 }}
                            >
                                /p/{publishDeployment.publishId}
                            </a>
                            <button
                                type="button"
                                onClick={handleCopyPublishLink}
                                style={{
                                    background: "transparent",
                                    border: "1px solid rgba(34,211,238,0.30)",
                                    color: "#22d3ee",
                                    borderRadius: "var(--radius)",
                                    padding: "0.15rem 0.5rem",
                                    cursor: "pointer",
                                    fontSize: "0.72rem",
                                }}
                            >
                                {publishCopied ? "✓ Copiato" : "📋 Copia link"}
                            </button>
                            {/* Slug edit toggle */}
                            <button
                                type="button"
                                onClick={() => {
                                    setSlugInput(publishDeployment.customSlug ?? "");
                                    setSlugEditMode((v) => !v);
                                    setSlugCheckState("idle");
                                }}
                                style={{
                                    background: "transparent",
                                    border: "1px solid rgba(34,211,238,0.25)",
                                    color: "#22d3ee",
                                    borderRadius: "var(--radius)",
                                    padding: "0.15rem 0.5rem",
                                    cursor: "pointer",
                                    fontSize: "0.72rem",
                                    opacity: 0.75,
                                }}
                            >
                                {publishDeployment.customSlug ? "✏ Slug" : "🔗 Imposta slug"}
                            </button>
                            <button
                                type="button"
                                onClick={handleUnpublish}
                                disabled={publishState === "loading"}
                                style={{
                                    background: "transparent",
                                    border: "1px solid rgba(239,68,68,0.30)",
                                    color: "#ef4444",
                                    borderRadius: "var(--radius)",
                                    padding: "0.15rem 0.5rem",
                                    cursor: "pointer",
                                    fontSize: "0.72rem",
                                }}
                            >
                                Rimuovi
                            </button>
                            {isPublishStale && (
                                <>
                                    <span style={{ color: "#f59e0b", fontSize: "0.72rem", display: "flex", alignItems: "center", gap: "0.2rem" }}>
                                        ⚠ online v{publishedVersionNumber ?? "?"}, attiva v{activeVersionNumber ?? "?"}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handlePublish}
                                        disabled={publishState === "loading"}
                                        style={{
                                            background: "transparent",
                                            border: "1px solid rgba(245,158,11,0.40)",
                                            color: "#f59e0b",
                                            borderRadius: "var(--radius)",
                                            padding: "0.15rem 0.5rem",
                                            cursor: "pointer",
                                            fontSize: "0.72rem",
                                        }}
                                    >
                                        Aggiorna
                                    </button>
                                </>
                            )}
                        </div>

                        {/* Row 2: inline slug editor (shown when slugEditMode) */}
                        {slugEditMode && (
                            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", paddingTop: "0.15rem" }}>
                                <input
                                    type="text"
                                    value={slugInput}
                                    onChange={(e) => setSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                                    placeholder="es. mia-pizzeria"
                                    maxLength={30}
                                    style={{
                                        background: "var(--surface)",
                                        border: "1px solid rgba(34,211,238,0.35)",
                                        borderRadius: "var(--radius)",
                                        color: "var(--text)",
                                        fontSize: "0.78rem",
                                        padding: "0.15rem 0.45rem",
                                        width: "14rem",
                                        outline: "none",
                                    }}
                                />
                                <span style={{
                                    fontSize: "0.72rem",
                                    color: slugCheckState === "available" ? "#4ade80"
                                        : slugCheckState === "taken" ? "#ef4444"
                                        : slugCheckState === "invalid" ? "#f59e0b"
                                        : slugCheckState === "checking" ? "#6b7280"
                                        : "#6b7280",
                                    minWidth: "4.5rem",
                                }}>
                                    {slugCheckState === "checking" ? "⏳ Verifica…"
                                        : slugCheckState === "available" ? "✓ Disponibile"
                                        : slugCheckState === "taken" ? "✗ Già in uso"
                                        : slugCheckState === "invalid" ? "⚠ Formato non valido"
                                        : ""}
                                </span>
                                <button
                                    type="button"
                                    onClick={handleSlugSave}
                                    disabled={slugSaving || (!!slugInput.trim() && slugCheckState !== "available")}
                                    style={{
                                        background: "transparent",
                                        border: "1px solid rgba(74,222,128,0.40)",
                                        color: "#4ade80",
                                        borderRadius: "var(--radius)",
                                        padding: "0.15rem 0.5rem",
                                        cursor: slugSaving || (!!slugInput.trim() && slugCheckState !== "available") ? "not-allowed" : "pointer",
                                        fontSize: "0.72rem",
                                        opacity: slugSaving || (!!slugInput.trim() && slugCheckState !== "available") ? 0.45 : 1,
                                    }}
                                >
                                    {slugSaving ? "⏳" : "Salva"}
                                </button>
                                {publishDeployment.customSlug && (
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            setSlugSaving(true);
                                            try {
                                                const updated = await updateDeploymentSlug(token!, projectId, null);
                                                setPublishDeployment(updated);
                                                setSlugEditMode(false);
                                                setSlugInput("");
                                            } catch { /* ignore */ } finally { setSlugSaving(false); }
                                        }}
                                        disabled={slugSaving}
                                        style={{
                                            background: "transparent",
                                            border: "1px solid rgba(239,68,68,0.30)",
                                            color: "#ef4444",
                                            borderRadius: "var(--radius)",
                                            padding: "0.15rem 0.5rem",
                                            cursor: "pointer",
                                            fontSize: "0.72rem",
                                        }}
                                    >
                                        Rimuovi slug
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => { setSlugEditMode(false); setSlugInput(""); setSlugCheckState("idle"); }}
                                    style={{
                                        background: "transparent",
                                        border: "none",
                                        color: "#6b7280",
                                        cursor: "pointer",
                                        fontSize: "0.72rem",
                                        padding: "0.15rem 0.3rem",
                                    }}
                                >
                                    Annulla
                                </button>
                            </div>
                        )}
                    </div>
                )}

                <div className="workspace-preview-canvas">
                    {!artifacts && (
                        <div style={emptyStateStyle}>
                            <div style={{ fontSize: "2.2rem", marginBottom: "0.75rem" }}>⬡</div>
                            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.4rem" }}>Nessun codice generato</h2>
                            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", maxWidth: 480, textAlign: "center" }}>
                                Il centro mostra solo artifacts HTML/CSS/JS generati dal backend. Invia un prompt per popolare la preview.
                            </p>
                        </div>
                    )}

                    {artifacts && previewTab === "preview" && (
                        <>
                        {previewRefreshing && (
                            <div
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    zIndex: 50,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    background: "rgba(10,15,26,0.52)",
                                    borderRadius: "var(--radius)",
                                    backdropFilter: "blur(2px)",
                                    pointerEvents: "none",
                                }}
                            >
                                <span
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "0.55rem",
                                        background: "rgba(15,21,35,0.88)",
                                        border: "1px solid var(--border)",
                                        borderRadius: "var(--radius)",
                                        padding: "0.45rem 1rem",
                                        color: "#22d3ee",
                                        fontSize: "0.82rem",
                                        fontWeight: 600,
                                        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                                    }}
                                >
                                    <span
                                        style={{
                                            width: 14,
                                            height: 14,
                                            border: "2px solid #22d3ee",
                                            borderTopColor: "transparent",
                                            borderRadius: "50%",
                                            animation: "pf-spin 0.7s linear infinite",
                                            display: "inline-block",
                                            flexShrink: 0,
                                        }}
                                    />
                                    Aggiornamento preview…
                                </span>
                            </div>
                        )}
                        <iframe
                            key={`${artifactsKey}-${previewForceKey}`}
                            ref={iframeRef}
                            title="preview"
                            srcDoc={previewDocWithInspect}
                            className="workspace-preview-iframe"
                            sandbox="allow-scripts"
                            onLoad={() => {
                                // Mark loaded so the watchdog timer knows not to force-remount
                                iframeLoadedRef.current = true;
                                // Hide spinner as soon as the iframe has actually loaded the new content
                                setPreviewRefreshing(false);
                                if (inspectMode) {
                                    // Re-arm inspect after iframe reload
                                    setTimeout(() => {
                                        iframeRef.current?.contentWindow?.postMessage({ type: "pf-inspect", on: true }, "*");
                                    }, 50);
                                }
                                if (editMode) {
                                    // Re-arm EDIT Light after iframe reload
                                    setTimeout(() => {
                                        iframeRef.current?.contentWindow?.postMessage({ type: "pf-edit", on: true }, "*");
                                    }, 80);
                                }
                            }}
                        />
                        </>
                    )}

                    {artifacts && previewTab === "html" && (
                        <CodeEditorPanel
                            key={`html-${artifactsKey}`}
                            language="html"
                            value={editorHtml}
                            onChange={(value) => setEditorHtml(value)}
                            onSelectionChange={setEditorSelectionLabel}
                            onCodeSelectionChange={(data) =>
                                setCodeEditorSelection(data ? { language: "html", ...data } : null)
                            }
                            onSave={activeConvId ? () => void handleSaveEditorSnapshot() : undefined}
                            isSaving={isSavingEditorSnapshot}
                        />
                    )}
                    {artifacts && previewTab === "css" && (
                        <CodeEditorPanel
                            key={`css-${artifactsKey}`}
                            language="css"
                            value={editorCss}
                            onChange={(value) => setEditorCss(value)}
                            onSelectionChange={setEditorSelectionLabel}
                            onCodeSelectionChange={(data) =>
                                setCodeEditorSelection(data ? { language: "css", ...data } : null)
                            }
                            onSave={activeConvId ? () => void handleSaveEditorSnapshot() : undefined}
                            isSaving={isSavingEditorSnapshot}
                        />
                    )}
                    {artifacts && previewTab === "js" && (
                        <CodeEditorPanel
                            key={`js-${artifactsKey}`}
                            language="javascript"
                            value={editorJs}
                            onChange={(value) => setEditorJs(value)}
                            onSelectionChange={setEditorSelectionLabel}
                            onCodeSelectionChange={(data) =>
                                setCodeEditorSelection(data ? { language: "js", ...data } : null)
                            }
                            onSave={activeConvId ? () => void handleSaveEditorSnapshot() : undefined}
                            isSaving={isSavingEditorSnapshot}
                        />
                    )}



                    {previewTab === "prompt" && (
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                flex: 1,
                                minHeight: 0,
                                background: "#0b1220",
                            }}
                        >
                            {/* Toolbar */}
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.6rem",
                                    padding: "0.35rem 0.75rem",
                                    borderBottom: "1px solid var(--border)",
                                    flexShrink: 0,
                                }}
                            >
                                <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
                                    System prompt composto passato all&apos;LLM — sola lettura
                                    {promptPreview && (
                                        <span style={{ color: "var(--accent, #22d3ee)", marginLeft: "0.75rem" }}>
                                            ~{promptPreview.tokenEstimate} token · preset: {promptPreview.presetId ?? "nessuno"}
                                        </span>
                                    )}
                                </span>
                                <button
                                    type="button"
                                    disabled={loadingPromptPreview}
                                    onClick={() => void loadPromptPreview()}
                                    style={{
                                        marginLeft: "auto",
                                        fontSize: "0.78rem",
                                        padding: "0.25rem 0.75rem",
                                        background: "transparent",
                                        color: "var(--accent, #22d3ee)",
                                        border: "1px solid var(--accent, #22d3ee)",
                                        borderRadius: "var(--radius)",
                                        cursor: loadingPromptPreview ? "wait" : "pointer",
                                        fontWeight: 600,
                                    }}
                                >
                                    {loadingPromptPreview ? "Caricamento…" : "↻ Ricarica"}
                                </button>
                            </div>
                            {/* Layer panels */}
                            <div
                                style={{
                                    flex: 1,
                                    overflowY: "auto",
                                    padding: "1rem",
                                }}
                            >
                                {!promptPreview && !loadingPromptPreview && (
                                    <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
                                        Il prompt verrà caricato automaticamente. Se non appare, clicca ↻ Ricarica.
                                    </p>
                                )}
                                {loadingPromptPreview && (
                                    <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Caricamento…</p>
                                )}
                                {promptPreview && (
                                    <>
                                        <PromptLayerBlock
                                            label="LAYER A — Vincoli base"
                                            badge="sempre attivo"
                                            badgeColor="#22d3ee"
                                            source="Costante del sistema"
                                            content={promptPreview.layers.a_baseConstraints}
                                        />
                                        <PromptLayerBlock
                                            label="LAYER B — Modulo preset"
                                            badge={promptPreview.presetId ? `preset: ${promptPreview.presetId}` : "nessun preset"}
                                            badgeColor={promptPreview.layers.b_presetModule ? "#a3e635" : "#6b7280"}
                                            source="Configurazione progetto (⚙ rotella)"
                                            content={promptPreview.layers.b_presetModule || "(vuoto — nessun preset assegnato al progetto)"}
                                            empty={!promptPreview.layers.b_presetModule}
                                        />
                                        <PromptLayerBlock
                                            label="LAYER C — Contesto stile"
                                            badge={promptPreview.layers.c_styleContext ? "moodboard + profilo utente" : "vuoto"}
                                            badgeColor={promptPreview.layers.c_styleContext ? "#fb923c" : "#6b7280"}
                                            source="Profilo utente (profilazione iniziale) + Moodboard progetto (⚙ rotella)"
                                            content={promptPreview.layers.c_styleContext || "(vuoto — nessun dato di profilazione utente o moodboard configurato)"}
                                            empty={!promptPreview.layers.c_styleContext}
                                        />
                                        <PromptLayerBlock
                                            label="LAYER D — Template personalizzato"
                                            badge="dormiente"
                                            badgeColor="#6b7280"
                                            source="Configurazione avanzata progetto (non attiva)"
                                            content={promptPreview.layers.d_prePromptTemplate || "(vuoto — nessun template personalizzato configurato)"}
                                            empty={!promptPreview.layers.d_prePromptTemplate}
                                        />
                                        {promptPreview.layers.budgetPolicy && (
                                            <PromptLayerBlock
                                                label="POLICY — Budget output"
                                                badge="sistema"
                                                badgeColor="#8b5cf6"
                                                source="Configurazione automatica token/output"
                                                content={promptPreview.layers.budgetPolicy}
                                            />
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </section>
        </div>

        <ProjectConfigPopup
            projectId={projectId}
            open={configOpen}
            onClose={() => setConfigOpen(false)}
            initialProjectName={projectName}
            onRename={(name: string) => setProjectName(name)}
            presetLabel={presetCatalog.find(p => p.id === projectPresetId)?.labelIt}
            briefGuideQuestions={presetCatalog.find(p => p.id === projectPresetId)?.briefGuideQuestions}
        />
        </>
    );
}

// ─── Snapshot History Panel ───────────────────────────────────────────────────

function SnapshotHistoryPanel({
    snapshots,
    selectedId,
    loading,
    onSelect,
    onActivate,
    onDelete,
    onRecover,
}: {
    snapshots: PreviewSnapshot[];
    selectedId: string | null;
    loading: boolean;
    onSelect: (id: string) => void;
    onActivate: (id: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onRecover: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        function onDown(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, []);

    const activeSnapshot = snapshots.find((s) => s.isActive) ?? snapshots[0] ?? null;
    const selectedSnapshot = snapshots.find((s) => s.id === selectedId) ?? activeSnapshot;
    const selectedIndex = snapshots.findIndex((s) => s.id === selectedSnapshot?.id);
    const selectedVersionNumber = selectedIndex === -1 ? snapshots.length : snapshots.length - selectedIndex;
    const isViewingOld = selectedSnapshot?.id !== activeSnapshot?.id;

    return (
        <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            {/* Trigger */}
            <button
                type="button"
                className="secondary"
                onClick={() => setOpen((v) => !v)}
                style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.2rem 0.55rem" }}
            >
                {loading ? (
                    <span style={{ color: "var(--text-muted)" }}>…</span>
                ) : (
                    <>
                        <span style={{ fontWeight: 700 }}>v{selectedVersionNumber}</span>
                        {selectedSnapshot?.metadata?.model && (
                            <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
                                {selectedSnapshot.metadata.model.split("/").pop()}
                            </span>
                        )}
                        <span style={{ color: "var(--text-muted)" }}>▾</span>
                    </>
                )}
            </button>

            {/* Recupera button (visible when viewing a non-active snapshot) */}
            {isViewingOld && (
                <button
                    type="button"
                    className="secondary"
                    onClick={onRecover}
                    style={{ fontSize: "0.72rem", padding: "0.2rem 0.5rem", color: "var(--accent-text)" }}
                    title="Torna alla versione attiva"
                >
                    Recupera
                </button>
            )}

            {/* Dropdown panel */}
            {open && (
                <div
                    style={{
                        position: "absolute",
                        top: "calc(100% + 4px)",
                        right: 0,
                        zIndex: 200,
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
                        minWidth: 340,
                        maxHeight: 420,
                        overflowY: "auto",
                    }}
                >
                    <div
                        style={{
                            padding: "0.55rem 0.85rem 0.35rem",
                            fontSize: "0.68rem",
                            fontWeight: 700,
                            color: "var(--text-muted)",
                            textTransform: "uppercase",
                            letterSpacing: "0.07em",
                            borderBottom: "1px solid var(--border)",
                        }}
                    >
                        Cronologia Preview · {snapshots.length} versioni
                    </div>

                    {snapshots.map((snap, i) => {
                        const vn = snapshots.length - i;
                        const isSel = snap.id === selectedId;
                        const isAct = snap.isActive;
                        const time = new Date(snap.createdAt).toLocaleTimeString("it-IT", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                        });
                        const tokens = snap.metadata?.tokenUsage?.totalTokens;
                        const model = snap.metadata?.model?.split("/").pop() ?? snap.metadata?.model;
                        const isEmpty = !snap.artifacts?.html;

                        return (
                            <div
                                key={snap.id}
                                onClick={() => {
                                    onSelect(snap.id);
                                    setOpen(false);
                                    if (!snap.isActive) void onActivate(snap.id);
                                }}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.6rem",
                                    padding: "0.6rem 0.85rem",
                                    cursor: "pointer",
                                    background: isSel ? "var(--surface-2)" : "transparent",
                                    borderBottom: i < snapshots.length - 1 ? "1px solid var(--border-subtle, var(--border))" : "none",
                                    transition: "background 0.1s",
                                }}
                                onMouseEnter={(e) => {
                                    if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "var(--surface-2)";
                                }}
                                onMouseLeave={(e) => {
                                    if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "transparent";
                                }}
                            >
                                {/* Version number */}
                                <span
                                    style={{
                                        fontSize: "0.82rem",
                                        fontWeight: 800,
                                        color: isAct ? "#22c55e" : "var(--text-muted)",
                                        minWidth: 30,
                                        fontVariantNumeric: "tabular-nums",
                                    }}
                                >
                                    v{vn}
                                </span>

                                {/* Meta */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", flexWrap: "wrap" }}>
                                        {snap.metadata?.finishReason === "manual-save" ? (
                                            <span className="badge" style={{ fontSize: "0.65rem", background: "rgba(34,211,238,0.15)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.3)" }}>✏ manuale</span>
                                        ) : snap.metadata?.finishReason === "wysiwyg-edit-light" ? (
                                            <span className="badge" style={{ fontSize: "0.65rem", background: "rgba(250,204,21,0.15)", color: "#facc15", border: "1px solid rgba(250,204,21,0.3)" }}>✎ EDIT</span>
                                        ) : snap.metadata?.finishReason === "wysiwyg-grapesjs" ? (
                                            <span className="badge" style={{ fontSize: "0.65rem", background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.3)" }}>⊕ GJS</span>
                                        ) : (
                                            model && <span className="badge purple" style={{ fontSize: "0.65rem" }}>{model}</span>
                                        )}
                                        {snap.metadata?.provider && snap.metadata.finishReason !== "manual-save" && snap.metadata.finishReason !== "wysiwyg-edit-light" && snap.metadata.finishReason !== "wysiwyg-grapesjs" && (
                                            <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                                                {snap.metadata.provider}
                                            </span>
                                        )}
                                        {isAct && (
                                            <span className="badge green" style={{ fontSize: "0.65rem" }}>attiva</span>
                                        )}
                                        {isEmpty && (
                                            <span className="badge" style={{ fontSize: "0.65rem", background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }} title="HTML vuoto – versione corrotta">⚠ vuota</span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.15rem", display: "flex", gap: "0.5rem" }}>
                                        <span>{time}</span>
                                        {tokens && <span>{tokens.toLocaleString()} tok</span>}
                                        {snap.metadata?.durationMs && (
                                            <span>{(snap.metadata.durationMs / 1000).toFixed(1)}s</span>
                                        )}
                                    </div>
                                </div>

                                {/* Delete button (only on non-active snapshots) */}
                                {!isAct && (
                                    <button
                                        type="button"
                                        className="secondary"
                                        style={{
                                            fontSize: "0.72rem",
                                            padding: "0.15rem 0.35rem",
                                            flexShrink: 0,
                                            color: "var(--danger, #ef4444)",
                                            lineHeight: 1,
                                        }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setConfirmDeleteId(snap.id);
                                        }}
                                        title="Elimina questa versione"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Delete confirmation modal */}
            {confirmDeleteId && (() => {
                const snapIdx = snapshots.findIndex((s) => s.id === confirmDeleteId);
                const versionLabel = snapIdx === -1 ? "?" : String(snapshots.length - snapIdx);
                return (
                    <div
                        style={{
                            position: "fixed",
                            inset: 0,
                            zIndex: 9999,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "rgba(0,0,0,0.5)",
                        }}
                        onClick={() => { if (!deleting) setConfirmDeleteId(null); }}
                    >
                        <div
                            style={{
                                background: "var(--surface)",
                                border: "1px solid var(--border)",
                                borderRadius: "var(--radius, 8px)",
                                padding: "1.5rem",
                                maxWidth: 360,
                                width: "90%",
                                boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <h4 style={{ margin: "0 0 0.6rem", fontSize: "0.95rem", fontWeight: 700 }}>
                                Elimina versione v{versionLabel}?
                            </h4>
                            <p style={{ margin: "0 0 1.2rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
                                Questa azione è irreversibile. La versione verrà eliminata definitivamente.
                            </p>
                            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                                <button
                                    type="button"
                                    className="secondary"
                                    style={{ fontSize: "0.78rem", padding: "0.3rem 0.8rem" }}
                                    onClick={() => setConfirmDeleteId(null)}
                                    disabled={deleting}
                                >
                                    Annulla
                                </button>
                                <button
                                    type="button"
                                    style={{
                                        fontSize: "0.78rem",
                                        padding: "0.3rem 0.8rem",
                                        background: "var(--danger, #ef4444)",
                                        color: "#fff",
                                        border: "none",
                                        borderRadius: "var(--radius, 6px)",
                                        cursor: deleting ? "wait" : "pointer",
                                        opacity: deleting ? 0.6 : 1,
                                    }}
                                    disabled={deleting}
                                    onClick={async () => {
                                        setDeleting(true);
                                        try {
                                            await onDelete(confirmDeleteId);
                                        } catch { /* silent */ }
                                        setDeleting(false);
                                        setConfirmDeleteId(null);
                                    }}
                                >
                                    {deleting ? "Eliminazione…" : "Elimina"}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

// ─── Inspect infrastructure ──────────────────────────────────────────────────

// Minified script injected into every preview iframe.
// Stays idle until it receives a { type: 'pf-inspect', on: true } postMessage.
const PF_INSPECT_SCRIPT =
    "<script data-pf-injected>(function(){var hl=null,sl=null,sty=document.createElement('style');sty.id='__pf_i';" +
    "(document.head||document.body).appendChild(sty);" +
    "var pfTb=function(){return document.getElementById('__pf_tb');};" +
    "function inTb(el){var t=pfTb();return t&&t.contains(el);}" +
    "function nodeId(el){var p=[],c=el;while(c&&c.parentElement&&c!==document.body){" +
    "var par=c.parentElement,idx=Array.prototype.indexOf.call(par.children,c);" +
    "p.unshift(c.tagName.toLowerCase()+':'+idx);c=par;}return 'body>'+p.join('>');" +
    "}function mkdata(el){var cls=Array.prototype.slice.call(el.classList);" +
    "var txt=(el.textContent||'').trim().slice(0,100);" +
    "var oh=el.outerHTML||'';oh=oh.replace(/ data-pf-[hse](=\"\")?/g,'');oh=oh.replace(/ style=\"\"/g,'');oh=oh.replace(/ (aos-init|aos-animate)/g,'');if(oh.length>12000)oh=oh.slice(0,12000);" +
    "return{stableNodeId:nodeId(el),selector:el.id?'#'+el.id:el.tagName.toLowerCase()+(cls.length?'.'+cls.join('.'):'')," +
    "tag:el.tagName.toLowerCase(),classes:cls,textSnippet:txt||undefined,outerHtml:oh||undefined};}" +
    "function over(e){if(inTb(e.target))return;if(hl&&hl!==e.target)hl.removeAttribute('data-pf-h');hl=e.target;if(hl)hl.setAttribute('data-pf-h','');}" +
    "function clk(e){if(inTb(e.target))return;e.preventDefault();e.stopPropagation();if(sl)sl.removeAttribute('data-pf-s');sl=e.target;" +
    "if(sl)sl.setAttribute('data-pf-s','');try{window.parent.postMessage({type:'pf-select',element:mkdata(e.target)},'*');}catch(x){}}" +
    "function on(){sty.textContent='[data-pf-h]{outline:2px solid rgba(99,102,241,.6)!important;cursor:crosshair!important}" +
    "[data-pf-s]{outline:2px solid #6366f1!important;outline-offset:2px!important}';" +
    "document.addEventListener('mouseover',over);document.addEventListener('click',clk,true);}" +
    "function off(){sty.textContent='';document.removeEventListener('mouseover',over);" +
    "document.removeEventListener('click',clk,true);" +
    "if(hl){hl.removeAttribute('data-pf-h');hl=null;}if(sl){sl.removeAttribute('data-pf-s');sl=null;}}" +
    "window.addEventListener('message',function(e){if(e.data&&e.data.type==='pf-inspect'){if(e.data.on)on();else off();}});" +
    "})();<" + "/script>";

/**
 * EDIT Light script — injected alongside PF_INSPECT_SCRIPT when editMode is active.
 *
 * Text elements become contentEditable on click (with a dashed teal outline).
 * Images respond to click by sending pf-edit-img-click to the parent.
 * A floating toolbar appears on text selection with formatting tools (Canva-style).
 *
 * Messages received from parent:
 *   { type: 'pf-edit', on: bool }         — arm / disarm the script
 *   { type: 'pf-edit-trigger-save' }       — serialise DOM, send pf-edit-save to parent
 *   { type: 'pf-edit-set-img-src', selector, newSrc } — update an img src
 */
const PF_EDIT_SCRIPT = `<script data-pf-injected>(function(){
var editOn=false,eds=new Set();
var TEXT_TAGS=['P','H1','H2','H3','H4','H5','H6','SPAN','LI','TD','TH','BUTTON','A','LABEL','STRONG','EM','B','I','U','BLOCKQUOTE','FIGCAPTION','CAPTION','DT','DD'];

/* ── Toolbar UI — Canva-style floating bar ── */
var tb=document.createElement('div');
tb.id='__pf_tb';
tb.style.cssText='position:fixed;z-index:999999;display:none;align-items:center;gap:2px;padding:4px 6px;'+
  'background:#1e1e2e;border:1px solid #383850;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.45);'+
  'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;user-select:none;';
var BTNS=[
  {cmd:'bold',      icon:'B',  tip:'Grassetto',s:'font-weight:800'},
  {cmd:'italic',    icon:'I',  tip:'Corsivo',  s:'font-style:italic'},
  {cmd:'underline', icon:'U',  tip:'Sottolineato',s:'text-decoration:underline'},
  {cmd:'strikethrough',icon:'S',tip:'Barrato',s:'text-decoration:line-through'},
  {sep:true},
  {cmd:'formatBlock',arg:'H1',icon:'H1',tip:'Titolo 1',s:'font-weight:700;font-size:13px'},
  {cmd:'formatBlock',arg:'H2',icon:'H2',tip:'Titolo 2',s:'font-weight:700;font-size:12px'},
  {cmd:'formatBlock',arg:'H3',icon:'H3',tip:'Titolo 3',s:'font-weight:600;font-size:11px'},
  {cmd:'formatBlock',arg:'P', icon:'¶', tip:'Paragrafo'},
  {sep:true},
  {cmd:'justifyLeft',  icon:'\u2261',tip:'Allinea a sinistra'},
  {cmd:'justifyCenter',icon:'\u2263',tip:'Centra'},
  {cmd:'justifyRight', icon:'\u2262',tip:'Allinea a destra'},
  {sep:true},
  {cmd:'insertUnorderedList',icon:'\u2022',tip:'Elenco puntato'},
  {cmd:'insertOrderedList', icon:'1.',tip:'Elenco numerato'},
  {sep:true},
  {cmd:'createLink',icon:'\uD83D\uDD17',tip:'Inserisci link'},
  {cmd:'removeFormat',icon:'\u2718',tip:'Rimuovi formattazione'}
];
BTNS.forEach(function(b){
  if(b.sep){
    var sp=document.createElement('span');
    sp.style.cssText='width:1px;height:18px;background:#484860;margin:0 3px;flex-shrink:0;';
    tb.appendChild(sp);return;
  }
  var btn=document.createElement('button');
  btn.type='button';
  btn.title=b.tip||'';
  btn.textContent=b.icon;
  btn.style.cssText='all:unset;display:inline-flex;align-items:center;justify-content:center;'+
    'width:28px;height:28px;border-radius:6px;color:#cdd6f4;cursor:pointer;font-size:12px;'+
    'transition:background .12s;'+(b.s||'');
  btn.addEventListener('mouseenter',function(){this.style.background='#45475a';});
  btn.addEventListener('mouseleave',function(){this.style.background='transparent';});
  btn.addEventListener('mousedown',function(ev){
    ev.preventDefault();ev.stopPropagation();
    var c=b.cmd;
    if(c==='createLink'){
      var url=prompt('URL del link:','https://');
      if(url)document.execCommand('createLink',false,url);
    }else if(c==='formatBlock'){
      document.execCommand('formatBlock',false,'<'+b.arg+'>');
    }else{
      document.execCommand(c,false,null);
    }
    updateActive();
  });
  btn.__pfCmd=b.cmd;
  btn.__pfArg=b.arg||null;
  tb.appendChild(btn);
});
document.body.appendChild(tb);

function updateActive(){
  var btns=tb.querySelectorAll('button');
  btns.forEach(function(btn){
    var c=btn.__pfCmd;if(!c)return;
    var on=false;
    try{
      if(c==='bold'||c==='italic'||c==='underline'||c==='strikethrough'||
         c==='insertUnorderedList'||c==='insertOrderedList'||
         c==='justifyLeft'||c==='justifyCenter'||c==='justifyRight'){
        on=document.queryCommandState(c);
      }else if(c==='formatBlock'&&btn.__pfArg){
        var v=document.queryCommandValue('formatBlock')||'';
        on=v.toLowerCase()===btn.__pfArg.toLowerCase();
      }
    }catch(x){}
    btn.style.background=on?'#585b70':'transparent';
    btn.style.color=on?'#cba6f7':'#cdd6f4';
  });
}

var tbVisible=false;
var activeEditEl=null;
function showTb(anchorRect){
  if(!anchorRect){
    var sel=window.getSelection();
    if(sel&&!sel.isCollapsed&&sel.rangeCount){
      anchorRect=sel.getRangeAt(0).getBoundingClientRect();
    }else if(activeEditEl){
      anchorRect=activeEditEl.getBoundingClientRect();
    }
  }
  if(!anchorRect||!anchorRect.width){hideTb();return;}
  tb.style.display='flex';
  tbVisible=true;
  var tbW=tb.offsetWidth,tbH=tb.offsetHeight;
  var x=anchorRect.left+(anchorRect.width-tbW)/2;
  var y=anchorRect.bottom+8;
  if(x<4)x=4; if(x+tbW>window.innerWidth-4)x=window.innerWidth-tbW-4;
  if(y+tbH>window.innerHeight-4)y=anchorRect.top-tbH-8;
  tb.style.left=x+'px';tb.style.top=y+'px';
  updateActive();
}
function hideTb(){tb.style.display='none';tbVisible=false;activeEditEl=null;}

/* ── Core edit logic ── */
function enableEl(el){if(el.__pfE)return;el.__pfE=true;el.contentEditable='true';
  el.style.outline='2px dashed rgba(34,211,238,0.6)';el.style.outlineOffset='1px';eds.add(el);}
function disableAll(){eds.forEach(function(el){el.contentEditable='false';
  el.style.outline='';el.style.outlineOffset='';el.__pfE=false;});eds.clear();hideTb();}
function cleanHtml(){var cl=document.documentElement.cloneNode(true);
  cl.querySelectorAll('#__pf_tb,[data-pf-injected],style#__pf_i').forEach(function(e){e.remove();});
  cl.querySelectorAll('[contenteditable]').forEach(function(e){e.removeAttribute('contenteditable');
  e.style.outline='';e.style.outlineOffset='';});
  cl.querySelectorAll('[data-pf-h],[data-pf-s],[data-pf-e]').forEach(function(e){
  e.removeAttribute('data-pf-h');e.removeAttribute('data-pf-s');e.removeAttribute('data-pf-e');});
  return '<!doctype html>'+cl.outerHTML;}
function onClick(e){if(!editOn)return;
  if(tb.contains(e.target))return;
  var el=e.target;
  if(el.tagName==='IMG'){e.preventDefault();e.stopPropagation();
  try{window.parent.postMessage({type:'pf-edit-img-click',selector:el.id?'#'+el.id:el.tagName.toLowerCase(),currentSrc:el.src},'*');}catch(x){}
  return;}
  if(TEXT_TAGS.includes(el.tagName)){enableEl(el);activeEditEl=el;showTb(el.getBoundingClientRect());return;}
  if(!el.children.length&&(el.textContent||'').trim()&&el.tagName!=='SCRIPT'&&el.tagName!=='STYLE'){enableEl(el);activeEditEl=el;showTb(el.getBoundingClientRect());}}
document.addEventListener('mouseup',function(){
  if(!editOn)return;setTimeout(function(){showTb();},10);
});
document.addEventListener('keyup',function(e){
  if(!editOn)return;
  if(e.key==='Shift'||e.key.startsWith('Arrow'))setTimeout(showTb,10);
  else if(tbVisible)updateActive();
});
document.addEventListener('mousedown',function(e){
  if(!editOn)return;
  if(!tb.contains(e.target))hideTb();
});
window.addEventListener('message',function(e){if(!e.data||typeof e.data!=='object')return;
  if(e.data.type==='pf-edit'){editOn=e.data.on;if(!editOn)disableAll();}
  if(e.data.type==='pf-edit-trigger-save'){try{window.parent.postMessage({type:'pf-edit-save',html:cleanHtml()},'*');}catch(x){}}
  if(e.data.type==='pf-edit-set-img-src'){try{var img=document.querySelector(e.data.selector);
  if(img&&img.tagName==='IMG')img.src=e.data.newSrc;}catch(x){}}});
document.addEventListener('click',onClick,true);
})();<` + `/script>`;

function getElementTargetType(tag: string): "html" | "css" | "js" | "component" | "section" {
    if (["section", "main", "article", "header", "footer", "nav", "aside"].includes(tag)) return "section";
    if (["button", "input", "select", "textarea", "form"].includes(tag)) return "component";
    return "html";
}

const TAILWIND_CDN = '<script src="https://cdn.tailwindcss.com"><\/script>';
const TAILWIND_CLASS_RE = /class=["'][^"']*(?:flex|grid|py-|px-|text-|bg-|font-|rounded|shadow|container|mx-auto)/i;
// Match only LOCAL placeholder stylesheet/script references (not CDN URLs starting with http/https//)
const EXTERNAL_CSS_RE = /<link[^>]+href=["'](?!https?:\/\/|\/\/)[^"']*\.css["'][^>]*\/?>/gi;
const EXTERNAL_JS_RE = /<script[^>]+src=["'](?!https?:\/\/|\/\/)[^"']*\.js["'][^>]*><\/script>/gi;

export type PreviewQuality = "clean" | "injected" | "fragment" | "raw-html" | "none";

export interface PreviewResult {
    doc: string;
    quality: PreviewQuality;
}

function ensureTailwind(doc: string): string {
    if (TAILWIND_CLASS_RE.test(doc) && !/cdn\.tailwindcss\.com/i.test(doc)) {
        return doc.replace("</head>", `${TAILWIND_CDN}</head>`);
    }
    return doc;
}

function buildPreviewDoc(html: string, css: string, js: string, rawResponse?: string): PreviewResult {
    const isFullDoc = /<!doctype/i.test(html) || /<html[\s>]/i.test(html);

    if (isFullDoc) {
        const hasExternalCss = EXTERNAL_CSS_RE.test(html);
        const hasExternalJs = EXTERNAL_JS_RE.test(html);
        const needsInjection = (css && hasExternalCss) || (js && hasExternalJs);

        const styleTag = css ? `<style>${css}</style>` : "";
        const scriptTag = js ? `<script>${js}<\/script>` : "";

        let doc = html;

        // Replace external refs with inline
        if (css) doc = doc.replace(EXTERNAL_CSS_RE, styleTag);
        if (js) doc = doc.replace(EXTERNAL_JS_RE, scriptTag);

        // Inject if replacement didn't fire (e.g. link was missing but css field has content)
        if (css && styleTag && !doc.includes(styleTag)) {
            doc = doc.replace("</head>", `${styleTag}</head>`);
        }
        if (js && scriptTag && !doc.includes(scriptTag)) {
            doc = doc.replace("</body>", `${scriptTag}</body>`);
        }

        doc = ensureTailwind(doc);

        return { doc, quality: needsInjection ? "injected" : "clean" };
    }

    // Fragment: wrap in full document
    if (html.trim()) {
        const styleTag = css ? `<style>${css}</style>` : "";
        const scriptTag = js ? `<script>${js}<\/script>` : "";
        const doc = ensureTailwind(
            `<!doctype html><html><head>${styleTag}</head><body>${html}${scriptTag}</body></html>`
        );
        return { doc, quality: "fragment" };
    }

    // Last resort: try to extract HTML from rawResponse
    if (rawResponse) {
        const fullDocMatch = rawResponse.match(/(<!DOCTYPE[\s\S]*<\/html>)/i);
        if (fullDocMatch?.[1]) {
            return { doc: ensureTailwind(fullDocMatch[1]), quality: "raw-html" };
        }
        const bodyMatch = rawResponse.match(/<body[\s\S]*<\/body>/i);
        if (bodyMatch?.[0]) {
            return {
                doc: ensureTailwind(`<!doctype html><html><head></head>${bodyMatch[0]}</html>`),
                quality: "raw-html",
            };
        }
    }

    return { doc: "", quality: "none" };
}

function parseChatFromContent(content: string): { summary: string; bullets: string[]; nextActions: string[] } | null {
    if (!content?.startsWith("```json")) return null;
    try {
        let jsonText = content.replace(/^```(?:json)?\s*\n?/i, "");
        const lastFence = jsonText.lastIndexOf("```");
        if (lastFence > 0) jsonText = jsonText.slice(0, lastFence).trim();
        const parsed = JSON.parse(jsonText) as { chat?: { summary?: string; bullets?: unknown; nextActions?: unknown } };
        if (parsed?.chat?.summary) return {
            summary: String(parsed.chat.summary),
            bullets: Array.isArray(parsed.chat.bullets) ? (parsed.chat.bullets as unknown[]).map(String) : [],
            nextActions: Array.isArray(parsed.chat.nextActions) ? (parsed.chat.nextActions as unknown[]).map(String) : [],
        };
    } catch { /* fall through */ }
    return null;
}

async function copyTextToClipboard(text: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    if (typeof document === "undefined") return;
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "true");
    helper.style.position = "absolute";
    helper.style.left = "-9999px";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    document.body.removeChild(helper);
}

function CodeEditorPanel({
    language,
    value,
    onChange,
    onSelectionChange,
    onCodeSelectionChange,
    onSave,
    isSaving,
}: {
    language: "html" | "css" | "javascript";
    value: string;
    onChange: (value: string) => void;
    onSelectionChange: (label: string) => void;
    onCodeSelectionChange?: (data: { startLine: number; endLine: number; selectedText: string } | null) => void;
    onSave?: () => void;
    isSaving?: boolean;
}) {
    const [fontSize, setFontSize] = useState(13);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editorRef = useRef<any>(null);

    const handleFormat = useCallback(() => {
        editorRef.current?.getAction("editor.action.formatDocument")?.run();
    }, []);

    const toolbarBtnStyle: React.CSSProperties = {
        background: "none",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        cursor: "pointer",
        color: "var(--text-muted)",
        fontSize: "0.7rem",
        padding: "0.15rem 0.45rem",
        lineHeight: 1.4,
    };

    return (
        <div className="workspace-code-editor-shell">
            {/* Editor toolbar */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    padding: "0.25rem 0.55rem",
                    background: "#0b1220",
                    borderBottom: "1px solid var(--border)",
                    flexShrink: 0,
                }}
            >
                <button
                    type="button"
                    style={toolbarBtnStyle}
                    onClick={handleFormat}
                    title="Formatta / Beautify (equivale a Alt+Shift+F)"
                >
                    ✦ Beautify
                </button>
                <span style={{ color: "var(--border)", fontSize: "0.72rem", userSelect: "none" }}>│</span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.68rem", userSelect: "none" }}>
                    Ctrl+scroll = zoom · Alt+Shift+F = format
                </span>
                {onSave && (
                    <button
                        type="button"
                        disabled={isSaving}
                        onClick={onSave}
                        title="Salva le modifiche come nuova versione preview (attiva)"
                        style={{
                            ...toolbarBtnStyle,
                            background: isSaving ? undefined : "rgba(34,211,238,0.08)",
                            color: isSaving ? "var(--text-muted)" : "#22d3ee",
                            borderColor: "#22d3ee",
                            cursor: isSaving ? "wait" : "pointer",
                            fontWeight: 700,
                        }}
                    >
                        {isSaving ? "Salvataggio…" : "💾 Salva versione"}
                    </button>
                )}
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    <span style={{ color: "var(--text-muted)", fontSize: "0.68rem", userSelect: "none" }}>Font</span>
                    <button
                        type="button"
                        style={toolbarBtnStyle}
                        onClick={() => setFontSize((s) => Math.max(10, s - 1))}
                        title="Riduci dimensione carattere"
                    >
                        A−
                    </button>
                    <span
                        style={{
                            color: "var(--text-muted)",
                            fontSize: "0.68rem",
                            minWidth: "3ch",
                            textAlign: "center",
                            userSelect: "none",
                        }}
                    >
                        {fontSize}
                    </span>
                    <button
                        type="button"
                        style={toolbarBtnStyle}
                        onClick={() => setFontSize((s) => Math.min(28, s + 1))}
                        title="Aumenta dimensione carattere"
                    >
                        A+
                    </button>
                </div>
            </div>
            <MonacoEditor
                height="100%"
                language={language}
                theme="vs-dark"
                value={value}
                onChange={(next) => onChange(next ?? "")}
                onMount={(editor) => {
                    editorRef.current = editor;
                    editor.focus();
                    // Auto-beautify on mount — handles minified single-line code
                    setTimeout(() => {
                        editor.getAction("editor.action.formatDocument")?.run();
                    }, 250);
                    editor.onDidChangeCursorSelection((event) => {
                        const selection = event.selection;
                        const start = Math.min(selection.startLineNumber, selection.endLineNumber);
                        const end = Math.max(selection.startLineNumber, selection.endLineNumber);
                        const hasSelection = !selection.isEmpty();

                        onSelectionChange(
                            hasSelection
                                ? `Selezione righe ${start}-${end}`
                                : `Cursore riga ${selection.positionLineNumber}, col ${selection.positionColumn}`
                        );

                        if (onCodeSelectionChange) {
                            if (hasSelection) {
                                const selectedText = editor.getModel()?.getValueInRange(selection) ?? "";
                                onCodeSelectionChange({ startLine: start, endLine: end, selectedText });
                            } else {
                                onCodeSelectionChange(null);
                            }
                        }
                    });
                }}
                options={{
                    // Layout
                    minimap: { enabled: true, renderCharacters: false, scale: 1 },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: "off",
                    // Typography
                    fontSize,
                    fontFamily: "JetBrains Mono, Fira Code, monospace",
                    fontLigatures: true,
                    lineNumbers: "on",
                    renderLineHighlight: "all",
                    tabSize: 2,
                    contextmenu: true,
                    // Brackets & indentation
                    bracketPairColorization: { enabled: true },
                    guides: { bracketPairs: true, bracketPairsHorizontal: true, indentation: true },
                    matchBrackets: "always",
                    // Hover card with docs & type info
                    hover: { enabled: true, delay: 300, sticky: true },
                    // Signature / parameter hints
                    parameterHints: { enabled: true, cycle: true },
                    // Inline completions while typing
                    quickSuggestions: { other: true, comments: false, strings: true },
                    suggestOnTriggerCharacters: true,
                    wordBasedSuggestions: "currentDocument",
                    suggest: {
                        showKeywords: true,
                        showSnippets: true,
                        showClasses: true,
                        showFunctions: true,
                        showVariables: true,
                        showConstants: true,
                        showMethods: true,
                        showProperties: true,
                        preview: true,
                        insertMode: "replace",
                    },
                    // Occurrence highlighting (all uses of the selected symbol)
                    occurrencesHighlight: "singleFile",
                    selectionHighlight: true,
                    // Sticky class/function header at the top of the viewport
                    stickyScroll: { enabled: true, maxLineCount: 5 },
                    // Color swatches for CSS values
                    colorDecorators: true,
                    // Code folding
                    folding: true,
                    foldingHighlight: true,
                    showFoldingControls: "always",
                    // Smooth UX
                    cursorSmoothCaretAnimation: "on",
                    smoothScrolling: true,
                    // Ctrl+scroll to zoom font size interactively
                    mouseWheelZoom: true,
                    // Auto-format pasted code
                    formatOnPaste: true,
                    // Inlay hints — type annotations and parameter names
                    inlayHints: { enabled: "on" },
                    // Code lens — reference counts etc (useful for JS)
                    codeLens: true,
                }}
            />
        </div>
    );
}

/** Estimated token count for a string (char/4 heuristic). */
function estimateTokens(text: string | undefined): number {
    if (!text) return 0;
    return Math.max(1, Math.round(text.length / 4));
}

/** Compact time label: <1 s → "540ms", else seconds with 1 decimal. */
function formatDuration(ms: number | undefined): string {
    if (!ms) return "—";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function RequestMetaInfo({ message, variant = "message" }: { message: MessageDto | undefined; variant?: "message" | "global" }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    if (!message || !message.metadata) return null;

    const m = message.metadata;
    const usage = m.tokenUsage;
    const cost = m.costEstimate;
    const trace = m.promptingTrace;

    // Preprompt weight
    const systemMsg = trace?.messagesSentToLlm?.find((x) => x.role === "system");
    const prePromptTokensEst = estimateTokens(systemMsg?.content);
    const prePromptChars = systemMsg?.content?.length ?? 0;
    const msgsSentCount = trace?.messagesSentToLlm?.length ?? 0;

    const tooltipTitle = variant === "global" ? "Dettagli ultima richiesta" : "Dettagli richiesta";

    // Compact label shown in the badge
    const badgeLabel = (() => {
        const parts: string[] = [];
        if (usage) parts.push(`${usage.totalTokens.toLocaleString()} tok`);
        if (m.executionTimeMs) parts.push(formatDuration(m.executionTimeMs));
        if (cost?.amount) parts.push(formatCostEur(cost.amount));
        return parts.length ? parts.join(" · ") : "info";
    })();

    return (
        <div ref={containerRef} className="req-meta-info"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
        >
            <button
                type="button"
                className="req-meta-badge"
                onClick={() => setOpen((v) => !v)}
                aria-label={tooltipTitle}
            >
                ℹ {badgeLabel}
            </button>

            {open && (
                <div className="req-meta-tooltip">
                    <div className="req-meta-tooltip-title">{tooltipTitle}</div>

                    {/* Provider / Model */}
                    <div className="req-meta-section">
                        <span className="req-meta-label">Provider</span>
                        <span className="req-meta-value">{m.provider ?? "—"}</span>
                    </div>
                    <div className="req-meta-section">
                        <span className="req-meta-label">Modello</span>
                        <span className="req-meta-value">{m.model ?? "—"}</span>
                    </div>
                    {m.finishReason && (
                        <div className="req-meta-section">
                            <span className="req-meta-label">Finish reason</span>
                            <span className="req-meta-value">{m.finishReason}</span>
                        </div>
                    )}

                    {/* Token usage */}
                    {usage && (
                        <>
                            <div className="req-meta-divider" />
                            <div className="req-meta-section">
                                <span className="req-meta-label">Prompt tokens</span>
                                <span className="req-meta-value">{usage.promptTokens.toLocaleString()}</span>
                            </div>
                            <div className="req-meta-section">
                                <span className="req-meta-label">Completion tokens</span>
                                <span className="req-meta-value">{usage.completionTokens.toLocaleString()}</span>
                            </div>
                            <div className="req-meta-section">
                                <span className="req-meta-label">Totale tokens</span>
                                <span className="req-meta-value" style={{ fontWeight: 600 }}>{usage.totalTokens.toLocaleString()}</span>
                            </div>
                        </>
                    )}

                    {/* Preprompt weight */}
                    {trace && (
                        <>
                            <div className="req-meta-divider" />
                            <div className="req-meta-section">
                                <span className="req-meta-label">Preprompt (system)</span>
                                <span className="req-meta-value">~{prePromptTokensEst.toLocaleString()} tok ({prePromptChars.toLocaleString()} chars)</span>
                            </div>
                            <div className="req-meta-section">
                                <span className="req-meta-label">Messaggi inviati a LLM</span>
                                <span className="req-meta-value">{msgsSentCount}</span>
                            </div>
                            {trace.promptConfigId && (
                                <div className="req-meta-section">
                                    <span className="req-meta-label">Prompt config ID</span>
                                    <span className="req-meta-value" style={{ fontSize: "0.6rem", wordBreak: "break-all" }}>{trace.promptConfigId}</span>
                                </div>
                            )}
                        </>
                    )}

                    {/* Timing */}
                    {m.executionTimeMs != null && (
                        <>
                            <div className="req-meta-divider" />
                            <div className="req-meta-section">
                                <span className="req-meta-label">Tempo esecuzione</span>
                                <span className="req-meta-value">{formatDuration(m.executionTimeMs)} ({m.executionTimeMs.toLocaleString()}ms)</span>
                            </div>
                        </>
                    )}

                    {/* Cost */}
                    {cost && (
                        <>
                            <div className="req-meta-divider" />
                            <div className="req-meta-section">
                                <span className="req-meta-label">Costo totale</span>
                                <span className="req-meta-value" style={{ fontWeight: 600 }}>{formatCostEur(cost.amount) || "€0"}</span>
                            </div>
                            <div className="req-meta-section">
                                <span className="req-meta-label">  Token cost</span>
                                <span className="req-meta-value">{formatCostEur(cost.breakdown.tokenCost) || "€0"}</span>
                            </div>
                            <div className="req-meta-section">
                                <span className="req-meta-label">  Image cost</span>
                                <span className="req-meta-value">{formatCostEur(cost.breakdown.imageCost) || "€0"}</span>
                            </div>
                            <div className="req-meta-section">
                                <span className="req-meta-label">  Video cost</span>
                                <span className="req-meta-value">{formatCostEur(cost.breakdown.videoCost) || "€0"}</span>
                            </div>
                            <div className="req-meta-section">
                                <span className="req-meta-label">€/1k tok</span>
                                <span className="req-meta-value">€{cost.unitRates.textEurPer1kTokens.toFixed(4)}</span>
                            </div>
                            {cost.providerCostUsd != null && (
                                <div className="req-meta-section">
                                    <span className="req-meta-label">Provider USD</span>
                                    <span className="req-meta-value">${cost.providerCostUsd.toFixed(6)}</span>
                                </div>
                            )}
                        </>
                    )}

                    {/* Parse status */}
                    {m.structuredParseValid != null && (
                        <>
                            <div className="req-meta-divider" />
                            <div className="req-meta-section">
                                <span className="req-meta-label">Structured parse</span>
                                <span className="req-meta-value">{m.structuredParseValid ? "✓ valido" : "✗ fallito"}</span>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function MessageBubble({ message }: { message: MessageDto }) {
    const [copyLabel, setCopyLabel] = useState("Copia");
    const isUser = message.role === "user";
    const isError = message.role === "error";

    const chatStructured = message.metadata?.chatStructured ?? (!isUser && !isError ? parseChatFromContent(message.content) : null);

    return (
        <div className="message-bubble-shell" style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", padding: "0.35rem 0.45rem" }}>
            <div
                className="message-bubble-content"
                style={{
                    maxWidth: "92%",
                    background: isUser ? "var(--accent)" : isError ? "rgba(239,68,68,0.12)" : "var(--surface)",
                    border: isUser ? "none" : `1px solid ${isError ? "rgba(239,68,68,0.3)" : "var(--border)"}`,
                    borderRadius: "var(--radius)",
                    padding: "0.55rem 0.75rem",
                    fontSize: "0.86rem",
                    lineHeight: 1.48,
                    color: isError ? "var(--danger)" : "var(--text)",
                    wordBreak: "break-word",
                }}
            >
                <button
                    type="button"
                    className="message-copy-button"
                    onClick={async () => {
                        try {
                            await copyTextToClipboard(message.content);
                            setCopyLabel("Copiato");
                            window.setTimeout(() => setCopyLabel("Copia"), 1200);
                        } catch {
                            setCopyLabel("Errore");
                            window.setTimeout(() => setCopyLabel("Copia"), 1200);
                        }
                    }}
                    title="Copia messaggio"
                    aria-label="Copia messaggio"
                >
                    {copyLabel}
                </button>
                {chatStructured ? (
                    <div>
                        <p style={{ margin: 0 }}>{chatStructured.summary}</p>
                        {chatStructured.bullets.length > 0 && (
                            <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                                {chatStructured.bullets.map((b, i) => <li key={i} style={{ marginBottom: "0.18rem" }}>{b}</li>)}
                            </ul>
                        )}
                        {chatStructured.nextActions.length > 0 && (
                            <div style={{ marginTop: "0.5rem" }}>
                                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Prossimi passi</div>
                                <ol style={{ margin: 0, paddingLeft: "1.2rem" }}>
                                    {chatStructured.nextActions.map((a, i) => <li key={i} style={{ marginBottom: "0.18rem" }}>{a}</li>)}
                                </ol>
                            </div>
                        )}
                    </div>
                ) : (
                    <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>
                )}
            </div>
            <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.18rem" }}>
                {message.role}
            </span>
            {!isUser && !isError && <RequestMetaInfo message={message} />}
        </div>
    );
}

// ─── Prompt Layer Block ───────────────────────────────────────────────────────

function PromptLayerBlock({
    label,
    badge,
    badgeColor,
    source,
    content,
    empty = false,
}: {
    label: string;
    badge: string;
    badgeColor: string;
    source: string;
    content: string;
    empty?: boolean;
}) {
    const [collapsed, setCollapsed] = React.useState(false);
    return (
        <div
            style={{
                marginBottom: "1rem",
                border: `1px solid ${empty ? "#2a3040" : "#2a3a50"}`,
                borderRadius: "6px",
                overflow: "hidden",
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.45rem 0.75rem",
                    background: empty ? "#111827" : "#0f1e35",
                    cursor: "pointer",
                    userSelect: "none",
                }}
                onClick={() => setCollapsed((c) => !c)}
            >
                <span style={{ fontSize: "0.72rem", color: "#6b7280", flexShrink: 0 }}>
                    {collapsed ? "▶" : "▼"}
                </span>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: empty ? "#4b5563" : "#e2e8f0", fontFamily: "monospace" }}>
                    {label}
                </span>
                <span
                    style={{
                        fontSize: "0.68rem",
                        padding: "0.1rem 0.45rem",
                        borderRadius: "9999px",
                        background: `${badgeColor}22`,
                        color: badgeColor,
                        border: `1px solid ${badgeColor}55`,
                        fontWeight: 600,
                        flexShrink: 0,
                    }}
                >
                    {badge}
                </span>
                <span style={{ fontSize: "0.68rem", color: "#4b5563", marginLeft: "auto", textAlign: "right" }}>
                    {source}
                </span>
            </div>
            {/* Body */}
            {!collapsed && (
                <pre
                    style={{
                        margin: 0,
                        padding: "0.75rem 1rem",
                        background: "#080e1a",
                        color: empty ? "#374151" : "#94a3b8",
                        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                        fontSize: "0.78rem",
                        lineHeight: 1.65,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        overflowX: "hidden",
                    }}
                >
                    {content}
                </pre>
            )}
        </div>
    );
}

const controlSelectStyle: React.CSSProperties = {
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: "var(--radius)",
    fontSize: "0.8rem",
    padding: "0.22rem 0.5rem",
    outline: "none",
    cursor: "pointer",
};

const emptyStateStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "var(--text)",
};

const textareaStyle: React.CSSProperties = {
    flex: 1,
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    color: "var(--text)",
    fontSize: "0.92rem",
    padding: "0.6rem 0.85rem",
    resize: "none",
    lineHeight: 1.5,
    outline: "none",
    fontFamily: "var(--font)",
};
