"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import dynamic from "next/dynamic";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import {
    getOrCreateProjectConversation,
    getConversation,
    addMessage,
    llmChatPreview,
    streamLlmChatPreview,
    getLlmProviders,
    logBackgroundTask,
    getLlmPromptConfig,
    getLlmPromptPreview,
    setLlmPromptConfig,
    streamOptimizePrompt,
    getPromptUsageSummary,
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
    listProjectAssets,
    getProjectAiAnalytics,
    generateProjectImage,
    suggestProjectImageIdea,
    downloadProjectAssetDataUrl,
    type SiteDeploymentDto,
    type ProjectAssetDto,
    type AiUsageAnalyticsDto,
    type SuggestProjectImageIdeaResult,
} from "../../../lib/api";
import { getToken } from "../../../lib/token-store";
import { useNotifications } from "../../../lib/notifications";
import { saveThumbnail, savePromptExcerpt, incrementSnapCount } from "../../../lib/thumbnail";
import ProjectConfigPopup from "../../../components/ProjectConfigPopup";
import MediaInspectorPanel from "../../../components/MediaInspectorPanel";
import { LlmProviderErrorDialog, type LlmProviderErrorDialogState } from "../../../components/LlmProviderErrorDialog";
import { MediaGrid, type MediaItem } from "@/components/media";
import { Mic, Settings, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WorkspaceHeader } from "../../../components/workspace/WorkspaceHeader";
import { PreviewViewportSelector, viewportDimensions, viewportWidth } from "../../../components/workspace/PreviewViewportSelector";
import type { PreviewViewport } from "../../../components/workspace/PreviewViewportSelector";
import { SnapshotHistoryPanel } from "../../../components/workspace/SnapshotHistoryPanel";
import { PF_INSPECT_SCRIPT, PF_EDIT_SCRIPT } from "./iframe-scripts";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
    ssr: false,
});



const SPLIT_COOKIE = "andy-code-cat_workspace_split";
const CHAT_VSPLIT_COOKIE = "andy-code-cat_chat_vsplit";

type BrowserSpeechRecognitionResult = {
    isFinal: boolean;
    0: { transcript: string };
};

type BrowserSpeechRecognitionEvent = Event & {
    resultIndex: number;
    results: ArrayLike<BrowserSpeechRecognitionResult>;
};

type BrowserSpeechRecognitionErrorEvent = Event & {
    error?: string;
};

type BrowserSpeechRecognition = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
    onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
    interface Window {
        SpeechRecognition?: BrowserSpeechRecognitionConstructor;
        webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    }
}

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

function getStringDetail(details: unknown, key: string): string | undefined {
    if (!details || typeof details !== "object") return undefined;
    const value = (details as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
}

function appendPromptSegment(base: string, addition: string): string {
    const normalizedAddition = addition.trim();
    if (!normalizedAddition) return base;
    if (!base.trim()) return normalizedAddition;
    const needsSpace = !/[\s\n]$/.test(base);
    return `${base}${needsSpace ? " " : ""}${normalizedAddition}`;
}

const PROJECT_ASSET_DOWNLOAD_PATH_RE = /\/v1\/projects\/([^/]+)\/assets\/([^/]+)\/download(?:$|\?)/i;

function parseProtectedAssetDownloadUrl(rawSrc: string): { projectId: string; assetId: string } | null {
    const trimmed = String(rawSrc ?? "").trim();
    if (!trimmed || typeof window === "undefined") return null;

    try {
        const url = new URL(trimmed, window.location.origin);
        const match = url.pathname.match(PROJECT_ASSET_DOWNLOAD_PATH_RE);
        if (!match?.[1] || !match?.[2]) return null;
        return {
            projectId: decodeURIComponent(match[1]),
            assetId: decodeURIComponent(match[2]),
        };
    } catch {
        return null;
    }
}

function sanitizeMediaElementPayload(element: SelectedFocusElement) {
    const safeUrl = (value?: string) => {
        const trimmed = value?.trim();
        if (!trimmed || trimmed.startsWith("data:")) return undefined;
        return trimmed.length > 1500 ? trimmed.slice(0, 1500) : trimmed;
    };

    return {
        stableNodeId: element.stableNodeId,
        selector: element.selector,
        tag: element.tag,
        textSnippet: clipFocusValue(element.textSnippet, 500),
        currentSrc: safeUrl(element.currentSrc),
        currentAlt: clipFocusValue(element.currentAlt, 300),
        backgroundImageUrl: safeUrl(element.backgroundImageUrl),
        mediaMode: element.mediaMode,
        originalWidth: element.originalWidth,
        originalHeight: element.originalHeight,
        aspectRatio: element.aspectRatio,
    };
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

type SelectedFocusElement = NonNullable<LlmFocusContext["selectedElement"]>;

const MAX_FOCUS_SELECTOR_LEN = 240;
const MAX_FOCUS_NODE_ID_LEN = 120;
const MAX_FOCUS_TEXT_LEN = 160;
const MAX_FOCUS_OUTER_HTML_LEN = 8000;
const MAX_FOCUS_CLASSES = 8;
const INVALID_FOCUS_TAGS = new Set(["html", "body", "head", "script", "style", "link", "meta"]);

function clipFocusValue(value: string | undefined, max: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function sanitizeSelectedElementForFocus(
    element: LlmFocusContext["selectedElement"] | null | undefined,
): SelectedFocusElement | null {
    if (!element) return null;

    const tag = clipFocusValue(element.tag?.toLowerCase(), 64);
    if (!tag || INVALID_FOCUS_TAGS.has(tag)) {
        return null;
    }

    const stableNodeId = clipFocusValue(element.stableNodeId, MAX_FOCUS_NODE_ID_LEN);
    const selector = clipFocusValue(element.selector, MAX_FOCUS_SELECTOR_LEN);
    if (!stableNodeId || !selector) {
        return null;
    }

    const classes = Array.isArray(element.classes)
        ? element.classes
            .map((item) => clipFocusValue(item, 60))
            .filter((item): item is string => Boolean(item))
            .slice(0, MAX_FOCUS_CLASSES)
        : [];

    const textSnippet = clipFocusValue(element.textSnippet, MAX_FOCUS_TEXT_LEN);
    const outerHtml = clipFocusValue(element.outerHtml, MAX_FOCUS_OUTER_HTML_LEN);
    const currentSrc = clipFocusValue(element.currentSrc, 1500);
    const currentAlt = clipFocusValue(element.currentAlt, 300);
    const backgroundImageUrl = clipFocusValue(element.backgroundImageUrl, 1500);
    const mediaMode = element.mediaMode === "foreground" || element.mediaMode === "background"
        ? element.mediaMode
        : ((currentSrc || backgroundImageUrl) ? "none" : undefined);
    const originalWidth = typeof element.originalWidth === "number" && Number.isFinite(element.originalWidth) && element.originalWidth > 0
        ? Math.round(element.originalWidth)
        : undefined;
    const originalHeight = typeof element.originalHeight === "number" && Number.isFinite(element.originalHeight) && element.originalHeight > 0
        ? Math.round(element.originalHeight)
        : undefined;
    const aspectRatio = typeof element.aspectRatio === "number" && Number.isFinite(element.aspectRatio) && element.aspectRatio > 0
        ? Math.round(element.aspectRatio * 1000) / 1000
        : (originalWidth && originalHeight ? Math.round((originalWidth / originalHeight) * 1000) / 1000 : undefined);

    if (outerHtml && /^<(html|body)\b/i.test(outerHtml)) {
        return null;
    }

    return {
        stableNodeId,
        selector,
        tag,
        classes,
        ...(textSnippet ? { textSnippet } : {}),
        ...(outerHtml ? { outerHtml } : {}),
        ...(currentSrc ? { currentSrc } : {}),
        ...(currentAlt ? { currentAlt } : {}),
        ...(backgroundImageUrl ? { backgroundImageUrl } : {}),
        ...(mediaMode ? { mediaMode } : {}),
        ...(originalWidth ? { originalWidth } : {}),
        ...(originalHeight ? { originalHeight } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
    };
}

function isFocusContextValidationError(error: unknown): boolean {
    if (!(error instanceof ApiError) || error.status !== 400) {
        return false;
    }

    const details = error.details as
        | { fieldErrors?: { focusContext?: unknown } }
        | undefined;

    return Array.isArray(details?.fieldErrors?.focusContext) && details.fieldErrors.focusContext.length > 0;
}

export default function WorkspacePage() {
    const { t } = useTranslation();
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
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
    const [optimizingPrompt, setOptimizingPrompt] = useState(false);
    const [activeOperation, setActiveOperation] = useState<"chat" | "prompt-optimizer" | null>(null);
    const [promptRestoreValue, setPromptRestoreValue] = useState<string | null>(null);
    const [promptOpsSummary, setPromptOpsSummary] = useState({ totalCost: 0, totalTokens: 0, runs: 0 });
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [llmErrorDialog, setLlmErrorDialog] = useState<LlmProviderErrorDialogState | null>(null);
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
    const imageModelOptions = React.useMemo(() => {
        const imageProviders = providersCatalog.filter((provider) =>
            provider.models.some((model) => model.isActive && model.capabilities.includes("image_generation")),
        );

        return imageProviders.flatMap((provider) => provider.models
            .filter((model) => model.isActive && model.capabilities.includes("image_generation"))
            .map((model) => ({
                id: model.id,
                label: `${model.displayName ?? model.id}${model.priceTier ? ` · ${model.priceTier}` : ""}`,
                provider: provider.provider,
                providerLabel: provider.provider,
            })));
    }, [providersCatalog]);
    const presetRecommendationAppliedRef = useRef<string | null>(null);
    const [voiceSupported, setVoiceSupported] = useState(false);
    const [voiceListening, setVoiceListening] = useState(false);
    const [voiceError, setVoiceError] = useState<string | null>(null);

    const [leftWidth, setLeftWidth] = useState(40);
    const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
    const speechBasePromptRef = useRef("");
    const speechCommittedTranscriptRef = useRef("");
    const [isDragging, setIsDragging] = useState(false);
    const [chatVSplit, setChatVSplit] = useState(65);
    const chatVSplitRef = useRef<number>(65);
    const chatBodyRef = useRef<HTMLDivElement>(null);
    const [isDraggingVChat, setIsDraggingVChat] = useState(false);
    const [previewViewport, setPreviewViewport] = useState<PreviewViewport>("desktop");
    const [previewTab, setPreviewTab] = useState<"preview" | "html" | "css" | "js" | "prompt">("preview");
    const [promptTemplate, setPromptTemplate] = useState("");
    const [promptEnabled, setPromptEnabled] = useState(true);
    const [isSavingPrompt, setIsSavingPrompt] = useState(false);
    const [promptPreview, setPromptPreview] = useState<LlmPromptPreviewDto | null>(null);
    const [loadingPromptPreview, setLoadingPromptPreview] = useState(false);
    const [previewSnapshots, setPreviewSnapshots] = useState<PreviewSnapshot[]>([]);
    const [selectedBackendSnapshotId, setSelectedBackendSnapshotId] = useState<string | null>(null);
    const [loadingSnapshots, setLoadingSnapshots] = useState(false);
    const selectedBackendSnapshotIdRef = useRef<string | null>(null);
    const [editorHtml, setEditorHtml] = useState("");
    const [editorCss, setEditorCss] = useState("");
    const [editorJs, setEditorJs] = useState("");
    const editorHtmlRef = useRef("");
    const editorCssRef = useRef("");
    const editorJsRef = useRef("");
    const [editorSelectionLabel, setEditorSelectionLabel] = useState<string>("");
    const [inspectMode, setInspectMode] = useState(false);
    const [selectedElement, setSelectedElement] = useState<LlmFocusContext["selectedElement"] | null>(null);
    const [selectedElementSource, setSelectedElementSource] = useState<"inspect" | "edit-media" | null>(null);
    const [mediaToolsOpen, setMediaToolsOpen] = useState(false);
    const [mediaInspectorSection, setMediaInspectorSection] = useState<"gen-image" | "gallery">("gen-image");
    // EDIT-mode media asset list scanned from the live preview iframe
    const [editMediaList, setEditMediaList] = useState<MediaItem[]>([]);
    const [projectAssets, setProjectAssets] = useState<ProjectAssetDto[]>([]);
    const [loadingProjectAssets, setLoadingProjectAssets] = useState(false);
    const [assetScope, setAssetScope] = useState<"project" | "user">("project");
    const [mediaMode, setMediaMode] = useState<"foreground" | "background">("foreground");
    const [backgroundFit, setBackgroundFit] = useState<"cover" | "contain" | "auto">("cover");
    const [backgroundRepeat, setBackgroundRepeat] = useState<"no-repeat" | "repeat" | "repeat-x" | "repeat-y">("no-repeat");
    const [mediaOpacity, setMediaOpacity] = useState(1);
    const [mediaFilter, setMediaFilter] = useState("none");
    const [generatingMedia, setGeneratingMedia] = useState(false);
    const [suggestingMedia, setSuggestingMedia] = useState(false);
    const [mediaSuggestion, setMediaSuggestion] = useState<SuggestProjectImageIdeaResult | null>(null);
    const [selectedImageModel, setSelectedImageModel] = useState("");
    const [selectedImageSize, setSelectedImageSize] = useState("1024x1024");
    const [selectedImageSteps, setSelectedImageSteps] = useState(4);
    const [projectAiAnalytics, setProjectAiAnalytics] = useState<AiUsageAnalyticsDto | null>(null);
    const [loadingAiAnalytics, setLoadingAiAnalytics] = useState(false);
    const [codeEditorSelection, setCodeEditorSelection] = useState<LlmFocusContext["codeSelection"] | null>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const assetPreviewUrlCacheRef = useRef<Map<string, string>>(new Map());
    const resolveSidebarMediaSrc = useCallback(async (rawSrc: string): Promise<string> => {
        const trimmed = String(rawSrc ?? "").trim();
        if (!trimmed) return "";
        if (/^(data|blob):/i.test(trimmed)) return trimmed;
        if (!token) return trimmed;

        const parsed = parseProtectedAssetDownloadUrl(trimmed);
        if (!parsed) return trimmed;

        const cacheKey = `${parsed.projectId}:${parsed.assetId}`;
        const cached = assetPreviewUrlCacheRef.current.get(cacheKey);
        if (cached) return cached;

        try {
            const dataUrl = await downloadProjectAssetDataUrl(token, parsed.projectId, parsed.assetId);
            if (dataUrl) {
                assetPreviewUrlCacheRef.current.set(cacheKey, dataUrl);
                return dataUrl;
            }
        } catch {
            // Fall back to the original URL; the thumbnail component will handle any load failure gracefully.
        }

        return trimmed;
    }, [token]);
    const hasPreviewArtifacts = Boolean(editorHtml || editorCss || editorJs);
    const clearSelectedElement = useCallback(() => {
        setSelectedElement(null);
        setSelectedElementSource(null);
        setMediaSuggestion(null);
        setMediaToolsOpen(false);
    }, []);

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
            label: t("workspace.notifications.export.label"),
            status: "running",
            message: t("workspace.notifications.export.running"),
        });
        try {
            // 1. Create the export record on the server
            const snapshotId = selectedBackendSnapshotId ?? undefined;
            const res = await requestLayer1Export(token, projectId, snapshotId);

            // 2. Download the ZIP blob using the Bearer token (no JWT-in-URL fragility)
            updateNotification(notifId, { message: t("workspace.notifications.export.downloading") });
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
            updateNotification(notifId, { status: "done", message: t("workspace.notifications.export.done") });
        } catch (err) {
            // 401 from the blob download = sessione scaduta — mostra la modal
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
                setExportState("idle");
                updateNotification(notifId, { status: "error", message: t("workspace.notifications.export.sessionExpired") });
                return;
            }
            const msg = err instanceof Error ? err.message : t("workspace.notifications.export.error");
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
        label: t("workspace.notifications.capture.label", { format: format.toUpperCase() }),
            status: "running",
            message: t("workspace.notifications.capture.running"),
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
            updateNotification(notifId, { status: "done", message: t("workspace.notifications.capture.done") });
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
                setCaptureState("idle");
                updateNotification(notifId, { status: "error", message: t("workspace.notifications.capture.sessionExpired") });
                return;
            }
            const msg = err instanceof Error ? err.message : t("workspace.notifications.capture.error");
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

    useEffect(() => {
        if (!token) return;
        getPromptUsageSummary(token, projectId)
            .then((summary) => setPromptOpsSummary(summary))
            .catch(() => setPromptOpsSummary({ totalCost: 0, totalTokens: 0, runs: 0 }));
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
            label: t("workspace.notifications.publish.label"),
            status: "running",
            message: t("workspace.notifications.publish.running"),
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
                message: vn ? t("workspace.notifications.publish.doneVersioned", { vn }) : t("workspace.notifications.publish.done"),
            });
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                window.dispatchEvent(new CustomEvent("session-expired"));
                setPublishState("idle");
                updateNotification(notifId, { status: "error", message: t("workspace.notifications.publish.sessionExpired") });
                return;
            }
            setPublishState("error");
            const msg = err instanceof Error ? err.message : t("workspace.notifications.publish.error");
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
        const savedVSplit = Number(getCookie(CHAT_VSPLIT_COOKIE));
        if (savedVSplit >= 30 && savedVSplit <= 85) {
            setChatVSplit(savedVSplit);
        }
    }, [router]);

    const loadProjectConversation = useCallback(
        async (authToken: string) => {
            setConversationLoading(true);
            try {
                const convParam = searchParams?.get("conv");
                const res = convParam
                    ? await getConversation(authToken, projectId, convParam)
                    : await getOrCreateProjectConversation(authToken, projectId);
                setActiveConv(res.conversation);
                setActiveConvId(res.conversation.id);
            } catch (err) {
                setError(err instanceof ApiError ? String(err.message) : t("workspace.notifications.conversation.loadError"));
            } finally {
                setConversationLoading(false);
            }
        },
        [projectId, searchParams, t]
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

    useEffect(() => {
        if (imageModelOptions.length === 0) {
            setSelectedImageModel("");
            return;
        }
        if (imageModelOptions.some((model) => model.id === selectedImageModel)) {
            return;
        }
        const siliconFlowFast = imageModelOptions.find((m) => m.provider === "siliconflow" && /schnell|turbo|fast/i.test(m.id));
        const anyFast = imageModelOptions.find((m) => /schnell|turbo|fast/i.test(m.id));
        const nextModel = siliconFlowFast ?? anyFast ?? imageModelOptions[0];
        setSelectedImageModel(nextModel?.id ?? "");
    }, [imageModelOptions, selectedImageModel]);

    useEffect(() => {
        if (!projectPresetId || presetRecommendationAppliedRef.current === projectPresetId) return;
        if (presetCatalog.length === 0 || providersCatalog.length === 0) return;

        const preset = presetCatalog.find((entry) => entry.id === projectPresetId);
        const recommendation = preset?.recommendedModel;
        if (!recommendation?.provider || !recommendation.modelId) return;

        const provider = providersCatalog.find((entry) => entry.provider === recommendation.provider);
        const model = provider?.models.find((entry) => entry.isActive && entry.id === recommendation.modelId);
        if (!provider || !model) return;

        setSelectedProvider(provider.provider);
        setSelectedModel(model.id);
        presetRecommendationAppliedRef.current = projectPresetId;
    }, [projectPresetId, presetCatalog, providersCatalog]);

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
        if ((sending || optimizingPrompt) && !isUserScrolled) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [sending, optimizingPrompt, thinkingText, draftAnswer, isUserScrolled]);

    useEffect(() => {
        if (!sending && !optimizingPrompt) return;
        if (!thinkingFlowRef.current) return;
        thinkingFlowRef.current.scrollTop = thinkingFlowRef.current.scrollHeight;
    }, [sending, optimizingPrompt, thinkingText]);

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
        selectedBackendSnapshotIdRef.current = selectedBackendSnapshotId;
    }, [selectedBackendSnapshotId]);

    useEffect(() => { editorHtmlRef.current = editorHtml; }, [editorHtml]);
    useEffect(() => { editorCssRef.current = editorCss; }, [editorCss]);
    useEffect(() => { editorJsRef.current = editorJs; }, [editorJs]);

    useEffect(() => {
        if (!token) {
            setPreviewSnapshots([]);
            setSelectedBackendSnapshotId(null);
            return;
        }
        void loadSnapshots(token);
    }, [token, loadSnapshots]);

    const loadProjectAssets = useCallback(async (activeToken?: string) => {
        const resolvedToken = activeToken ?? token;
        if (!resolvedToken) return;
        setLoadingProjectAssets(true);
        try {
            const res = await listProjectAssets(resolvedToken, projectId);
            setProjectAssets(res.assets);
        } catch {
            setProjectAssets([]);
        } finally {
            setLoadingProjectAssets(false);
        }
    }, [token, projectId]);

    const loadProjectAiUsage = useCallback(async (activeToken?: string) => {
        const resolvedToken = activeToken ?? token;
        if (!resolvedToken) return;
        setLoadingAiAnalytics(true);
        try {
            const analytics = await getProjectAiAnalytics(resolvedToken, projectId);
            setProjectAiAnalytics(analytics);
        } catch {
            setProjectAiAnalytics(null);
        } finally {
            setLoadingAiAnalytics(false);
        }
    }, [token, projectId]);

    useEffect(() => {
        if (!token) return;
        void loadProjectAssets(token);
        void loadProjectAiUsage(token);
    }, [token, loadProjectAssets, loadProjectAiUsage]);

    useEffect(() => {
        if (!selectedElement) return;
        if (selectedElement.mediaMode === "background") {
            setMediaMode("background");
        } else if (selectedElement.mediaMode === "foreground" || selectedElement.tag === "img") {
            setMediaMode("foreground");
        }
    }, [selectedElement]);

    useEffect(() => {
        setMediaSuggestion(null);
    }, [selectedElement?.stableNodeId, mediaMode]);

    useEffect(() => {
        if (!selectedElement?.aspectRatio) return;
        if (selectedElement.aspectRatio >= 1.45) {
            setSelectedImageSize("1280x720");
            return;
        }
        if (selectedElement.aspectRatio <= 0.8) {
            setSelectedImageSize("720x1280");
            return;
        }
        setSelectedImageSize("1024x1024");
    }, [selectedElement?.aspectRatio]);

    const applyMediaToPreview = useCallback((url: string): string => {
        if (!selectedElement) return "";

        iframeRef.current?.contentWindow?.postMessage({
            type: "pf-apply-media",
            selector: selectedElement.selector,
            mode: mediaMode,
            url,
            fit: backgroundFit,
            repeat: backgroundRepeat,
            opacity: mediaOpacity,
            filter: mediaFilter,
            alt: selectedElement.currentAlt ?? "",
            preserveWidth: selectedElement.originalWidth,
            preserveHeight: selectedElement.originalHeight,
            aspectRatio: selectedElement.aspectRatio,
        }, "*");

        const currentHtml = editorHtmlRef.current;
        let nextHtml = currentHtml;

        if (currentHtml.trim()) {
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(currentHtml, "text/html");
                const target = doc.querySelector(selectedElement.selector);
                if (target) {
                    if (mediaMode === "background") {
                        const targetEl = target as HTMLElement;
                        targetEl.style.backgroundImage = `url("${url}")`;
                        targetEl.style.backgroundPosition = "center center";
                        targetEl.style.backgroundSize = backgroundFit;
                        targetEl.style.backgroundRepeat = backgroundRepeat;
                        targetEl.style.opacity = String(mediaOpacity);
                        targetEl.style.filter = mediaFilter;
                    } else {
                        const img = target.tagName.toLowerCase() === "img"
                            ? target as HTMLImageElement
                            : target.querySelector("img");
                        if (img) {
                            img.setAttribute("src", url);
                            if (selectedElement.currentAlt) img.setAttribute("alt", selectedElement.currentAlt);
                            const imgEl = img as HTMLImageElement & HTMLElement;
                            imgEl.style.opacity = String(mediaOpacity);
                            imgEl.style.filter = mediaFilter;
                            imgEl.style.objectFit = backgroundFit === "auto" ? "cover" : backgroundFit;
                            imgEl.style.maxWidth = imgEl.style.maxWidth || "100%";
                            imgEl.style.display = imgEl.style.display || "block";
                            if (!img.getAttribute("width") && !imgEl.style.width && selectedElement.originalWidth) {
                                imgEl.style.width = `${selectedElement.originalWidth}px`;
                            }
                            if (!img.getAttribute("height") && !imgEl.style.height && selectedElement.originalHeight) {
                                imgEl.style.height = `${selectedElement.originalHeight}px`;
                            }
                            if (selectedElement.aspectRatio && !imgEl.style.aspectRatio) {
                                imgEl.style.aspectRatio = String(selectedElement.aspectRatio);
                            }
                        }
                    }

                    nextHtml = /<!doctype/i.test(currentHtml)
                        ? `<!doctype html>${doc.documentElement.outerHTML}`
                        : doc.body.innerHTML;
                }
            } catch {
                nextHtml = currentHtml;
            }
        }

        if (nextHtml !== currentHtml) {
            setEditorHtml(nextHtml);
        }

        setSelectedElement((prev) => prev ? {
            ...prev,
            currentSrc: mediaMode === "foreground" ? url : prev.currentSrc,
            backgroundImageUrl: mediaMode === "background" ? url : prev.backgroundImageUrl,
            mediaMode,
        } : prev);

        return nextHtml;
    }, [selectedElement, mediaMode, backgroundFit, backgroundRepeat, mediaOpacity, mediaFilter]);

    const persistWorkspaceSnapshot = useCallback(async (
        snapshotId: string,
        artifacts: { html: string; css: string; js: string },
        options?: { promptExcerpt?: string; refreshList?: boolean; setSelected?: boolean },
    ) => {
        saveThumbnail(projectId, artifacts);
        if (options?.promptExcerpt) {
            savePromptExcerpt(projectId, options.promptExcerpt);
        }
        incrementSnapCount(projectId);

        // Fetch the snapshot list BEFORE setting state so we can batch ALL
        // state updates into ONE synchronous React render.  If the list fetch
        // and the selectedId update land in different batches, React may fire
        // an intermediate render where artifactsKey already points to the new
        // snapshot but editorHtml still holds stale content — the iframe
        // remounts with blank/stale srcDoc.  (Same pattern used by the
        // streaming flow at the handleSend level.)
        let freshSnapshots: typeof previewSnapshots | null = null;
        if (token && options?.refreshList !== false) {
            try {
                const res = await listPreviewSnapshots(token, projectId);
                freshSnapshots = res.snapshots;
            } catch { /* silent — snapshot list is supplementary */ }
        }

        // --- single batched render from here ---
        if (freshSnapshots) {
            setPreviewSnapshots(freshSnapshots);
        }
        if (options?.setSelected !== false) {
            setSelectedBackendSnapshotId(snapshotId);
            // Pre-populate editor state in the same render so the iframe
            // remounts with correct content, not a stale/blank doc.
            setEditorHtml(artifacts.html);
            setEditorCss(artifacts.css);
            setEditorJs(artifacts.js);
        }
    }, [projectId, token]);

    const saveMediaVersion = useCallback(async (
        html: string,
        finishReason: string,
        options?: { promptExcerpt?: string; refreshList?: boolean; setSelected?: boolean },
    ): Promise<boolean> => {
        if (!token || !html.trim()) return false;

        try {
            let conversationId = activeConvId;
            if (!conversationId) {
                const response = await getOrCreateProjectConversation(token, projectId);
                setActiveConv(response.conversation);
                setActiveConvId(response.conversation.id);
                conversationId = response.conversation.id;
            }

            if (!conversationId) return false;

            const result = await createPreviewSnapshot(token, projectId, {
                conversationId,
                parentSnapshotId: selectedBackendSnapshotIdRef.current ?? undefined,
                artifacts: { html, css: editorCssRef.current, js: editorJsRef.current },
                metadata: { finishReason },
                activate: true,
            });
            await persistWorkspaceSnapshot(result.snapshot.id, { html, css: editorCssRef.current, js: editorJsRef.current }, options);
            return true;
        } catch {
            return false;
        }
    }, [token, activeConvId, projectId, persistWorkspaceSnapshot]);

    const handleApplyAsset = useCallback(async (asset: ProjectAssetDto) => {
        if (!token || !selectedElement) return;

        try {
            const resolvedUrl = asset.source === "url_reference"
                ? (asset.externalUrl ?? "")
                : asset.mimeType.startsWith("image/")
                    ? await downloadProjectAssetDataUrl(token, projectId, asset.id)
                    : "";

            if (!resolvedUrl) {
                addNotification({
                    label: t("workspace.notifications.media.notApplicableLabel"),
                    status: "error",
                    message: t("workspace.notifications.media.notApplicable"),
                });
                return;
            }

            const updatedHtml = applyMediaToPreview(resolvedUrl);
            const versioned = await saveMediaVersion(updatedHtml || editorHtmlRef.current, "media-apply");
            setConfigOpen(false);
            addNotification({
            label: versioned ? t("workspace.notifications.media.doneSaved") : t("workspace.notifications.media.done"),
                status: "done",
                message: versioned
                    ? t("workspace.notifications.media.doneSavedMessage", { name: asset.label ?? asset.originalName })
                    : t("workspace.notifications.media.doneMessage", { name: asset.label ?? asset.originalName }),
            });
        } catch (err) {
            const message = err instanceof ApiError ? err.message : t("workspace.notifications.media.error");
            addNotification({ label: t("workspace.notifications.media.errorLabel"), status: "error", message });
        }
    }, [token, selectedElement, projectId, addNotification, applyMediaToPreview, saveMediaVersion]);

    const handleApplyCurrentStyles = useCallback(async () => {
        if (!selectedElement) return;
        const currentUrl = mediaMode === "background"
            ? (selectedElement.backgroundImageUrl || selectedElement.currentSrc)
            : (selectedElement.currentSrc || selectedElement.backgroundImageUrl);

        if (!currentUrl) {
            addNotification({
                label: t("workspace.notifications.media.noActiveLabel"),
                status: "error",
                message: t("workspace.notifications.media.noActive"),
            });
            return;
        }

        const updatedHtml = applyMediaToPreview(currentUrl);
        const versioned = await saveMediaVersion(updatedHtml || editorHtmlRef.current, "media-style-update");
        addNotification({
            label: versioned ? t("workspace.notifications.style.doneSaved") : t("workspace.notifications.style.done"),
            status: "done",
            message: versioned
                ? t("workspace.notifications.style.doneSavedMessage")
                : t("workspace.notifications.style.doneMessage"),
        });
    }, [selectedElement, mediaMode, addNotification, applyMediaToPreview, saveMediaVersion]);

    const handleSuggestMedia = useCallback(async () => {
        if (!token || !selectedElement) return;

        setSuggestingMedia(true);
        const notifId = addNotification({
            label: t("workspace.notifications.imageSuggestion.label"),
            status: "running",
            message: t("workspace.notifications.imageSuggestion.running"),
        });

        try {
            const result = await suggestProjectImageIdea(token, projectId, {
                prompt: prompt.trim().slice(0, 2000) || undefined,
                targetMode: mediaMode,
                selectedElement: sanitizeMediaElementPayload(selectedElement),
            });

            setMediaSuggestion(result);
            updateNotification(notifId, {
                label: t("workspace.notifications.imageSuggestion.done"),
                status: "done",
                message: result.suggestion,
            });
        } catch (err) {
            const message = err instanceof ApiError ? err.message : t("workspace.notifications.imageSuggestion.error");
            updateNotification(notifId, { label: t("workspace.notifications.imageSuggestion.failed"), status: "error", message });
        } finally {
            setSuggestingMedia(false);
        }
    }, [token, selectedElement, prompt, projectId, mediaMode, addNotification, updateNotification]);

    const handleUseSuggestedMediaPrompt = useCallback(() => {
        if (!mediaSuggestion?.suggestedPrompt) return;
        setPrompt(mediaSuggestion.suggestedPrompt);
        addNotification({
            label: t("workspace.notifications.prompt.updated"),
            status: "done",
            message: t("workspace.notifications.prompt.updatedMessage"),
        });
    }, [mediaSuggestion, addNotification]);

    const runMediaGeneration = useCallback(async (
        generationPromptRaw: string,
        options?: { label?: string; initialMessage?: string; notificationId?: string },
    ): Promise<boolean> => {
        const generationPrompt = generationPromptRaw.trim().slice(0, 2000);
        if (!token || !selectedElement) return false;
        if (!generationPrompt) {
            const message = t("workspace.notifications.prompt.missing");
            if (options?.notificationId) {
                updateNotification(options.notificationId, { label: t("workspace.notifications.prompt.missingLabel"), status: "error", message });
            } else {
                addNotification({ label: t("workspace.notifications.prompt.missingLabel"), status: "error", message });
            }
            return false;
        }

        setGeneratingMedia(true);
        const notifId = options?.notificationId ?? addNotification({
            label: options?.label ?? t("workspace.notifications.imageGeneration.label"),
            status: "running",
            message: options?.initialMessage ?? t("workspace.notifications.imageGeneration.running"),
        });

        try {
            const result = await generateProjectImage(token, projectId, {
                prompt: generationPrompt,
                fileNameHint: `${selectedElement.tag || "media"}-${Date.now()}`,
                scope: assetScope,
                provider: imageModelOptions.find((m) => m.id === selectedImageModel)?.provider || "siliconflow",
                model: selectedImageModel || undefined,
                imageSize: selectedImageSize,
                numInferenceSteps: selectedImageSteps,
                targetMode: mediaMode,
                selectedElement: sanitizeMediaElementPayload(selectedElement),
                mediaConfig: {
                    fit: backgroundFit,
                    repeat: backgroundRepeat,
                    opacity: mediaOpacity,
                    filter: mediaFilter,
                },
            });

            setProjectAssets((prev) => [result.asset, ...prev.filter((entry) => entry.id !== result.asset.id)]);
            void loadProjectAiUsage(token);

            let placeholderApplied = false;
            let placeholderVersioned = false;
            try {
                const placeholderUrl = await downloadProjectAssetDataUrl(token, projectId, result.asset.id);
                const placeholderHtml = applyMediaToPreview(placeholderUrl);
                placeholderApplied = true;
                placeholderVersioned = await saveMediaVersion(
                    placeholderHtml || editorHtmlRef.current,
                    "image-generation-placeholder",
                    { promptExcerpt: generationPrompt, setSelected: false },
                );
            } catch {
                placeholderApplied = false;
                placeholderVersioned = false;
            }

            updateNotification(notifId, {
                label: t("workspace.notifications.imageGeneration.started"),
                status: "running",
                message: placeholderApplied
                    ? (placeholderVersioned
                        ? "Placeholder applicato e salvato come nuova versione. L'immagine finale avanzerà di nuovo la working view quando sarà pronta."
                        : "Placeholder applicato nella working view. Se il salvataggio versione non è ancora disponibile, l'immagine finale verrà comunque registrata appena pronta.")
                    : "Richiesta inviata correttamente. Se il placeholder non è subito disponibile, l'immagine finale verrà comunque applicata appena pronta.",
            });

            void (async () => {
                const startedAt = Date.now();
                const maxWaitMs = 45_000;
                const pollIntervalMs = 2_000;

                try {
                    while (Date.now() - startedAt < maxWaitMs) {
                        await new Promise((resolve) => window.setTimeout(resolve, pollIntervalMs));

                        let trackedAsset: ProjectAssetDto | undefined;
                        try {
                            const refreshed = await listProjectAssets(token, projectId);
                            setProjectAssets(refreshed.assets);
                            void loadProjectAiUsage(token);
                            trackedAsset = refreshed.assets.find((entry) => entry.id === result.asset.id);
                        } catch {
                            continue;
                        }

                        if (!trackedAsset) {
                            continue;
                        }

                        if (trackedAsset.generationStatus === "failed") {
                            updateNotification(notifId, {
                                label: t("workspace.notifications.imageGeneration.failed"),
                                status: "error",
                                message: t("workspace.notifications.imageGeneration.failedMessage", { error: trackedAsset.generationMetadata?.errorMessage ?? "" }),
                            });
                            return;
                        }

                        if (trackedAsset.generationStatus === "ready" && trackedAsset.mimeType.startsWith("image/")) {
                            const finalUrl = await downloadProjectAssetDataUrl(token, projectId, trackedAsset.id);
                            const finalHtml = applyMediaToPreview(finalUrl);
                            const finalVersioned = await saveMediaVersion(
                                finalHtml || editorHtmlRef.current,
                                "image-generation-ready",
                                { promptExcerpt: generationPrompt },
                            );
                            updateNotification(notifId, {
                                label: finalVersioned ? t("workspace.notifications.imageGeneration.doneSaved") : t("workspace.notifications.imageGeneration.done"),
                                status: "done",
                                message: finalVersioned
                                    ? t("workspace.notifications.imageGeneration.doneSavedMessage", { name: trackedAsset.label ?? trackedAsset.originalName })
                                    : t("workspace.notifications.imageGeneration.doneMessage", { name: trackedAsset.label ?? trackedAsset.originalName }),
                            });
                            return;
                        }
                    }

                    updateNotification(notifId, {
                        label: t("workspace.notifications.imageGeneration.stillRunning"),
                        status: "running",
                        message: t("workspace.notifications.imageGeneration.stillRunningMessage"),
                    });
                    void loadProjectAssets(token);
                    void loadProjectAiUsage(token);
                } catch {
                    void loadProjectAssets(token);
                    void loadProjectAiUsage(token);
                }
            })();

            return true;
        } catch (err) {
            const message = err instanceof ApiError ? err.message : t("workspace.notifications.imageGeneration.error");
            updateNotification(notifId, { label: t("workspace.notifications.imageGeneration.failed"), status: "error", message });
            return false;
        } finally {
            setGeneratingMedia(false);
        }
    }, [token, selectedElement, projectId, assetScope, selectedImageModel, selectedImageSize, selectedImageSteps, mediaMode, backgroundFit, backgroundRepeat, mediaOpacity, mediaFilter, imageModelOptions, updateNotification, addNotification, loadProjectAiUsage, applyMediaToPreview, saveMediaVersion, loadProjectAssets]);

    const handleGenerateMedia = useCallback(async () => {
        const generationPrompt = (prompt.trim() || mediaSuggestion?.suggestedPrompt?.trim() || "").trim().slice(0, 2000);
        await runMediaGeneration(generationPrompt, { label: t("workspace.notifications.imageGeneration.label") });
    }, [prompt, mediaSuggestion, runMediaGeneration]);

    const handleQuickGenerateMedia = useCallback(async () => {
        if (!token || !selectedElement) return;

        setSuggestingMedia(true);
        const notifId = addNotification({
            label: t("workspace.notifications.imageGeneration.autoLabel"),
            status: "running",
            message: t("workspace.notifications.imageGeneration.autoRunning"),
        });

        try {
            const suggestionResult = await suggestProjectImageIdea(token, projectId, {
                prompt: prompt.trim().slice(0, 2000) || undefined,
                targetMode: mediaMode,
                selectedElement: sanitizeMediaElementPayload(selectedElement),
            });

            setMediaSuggestion(suggestionResult);

            const autoPrompt = (
                suggestionResult.suggestedPrompt?.trim()
                || suggestionResult.suggestion?.trim()
                || "Refresh or improve the selected image while preserving the page style."
            ).slice(0, 2000);

            updateNotification(notifId, {
                label: t("workspace.notifications.imageGeneration.autoLabel"),
                status: "running",
                message: t("workspace.notifications.imageGeneration.autoBrief"),
            });

            await runMediaGeneration(autoPrompt, {
                label: t("workspace.notifications.imageGeneration.autoLabel"),
                initialMessage: t("workspace.notifications.imageGeneration.autoBrief"),
                notificationId: notifId,
            });
        } catch (err) {
            const message = err instanceof ApiError ? err.message : t("workspace.notifications.imageGeneration.autoError");
            updateNotification(notifId, { label: t("workspace.notifications.imageGeneration.autoLabel"), status: "error", message });
        } finally {
            setSuggestingMedia(false);
        }
    }, [token, selectedElement, addNotification, projectId, prompt, mediaMode, updateNotification, runMediaGeneration]);

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
            addNotification({ label: t("workspace.notifications.snapshot.savedLabel"), status: "done", message: t("workspace.notifications.snapshot.saved") });
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
                const safeElement = sanitizeSelectedElementForFocus(event.data.element as LlmFocusContext["selectedElement"]);
                setSelectedElement(safeElement);
                setSelectedElementSource(safeElement ? "inspect" : null);
                setMediaToolsOpen(false);
                return;
            }
            if (event.data.type === "pf-edit-img-click") {
                const safeElement = sanitizeSelectedElementForFocus((event.data.element ?? event.data) as LlmFocusContext["selectedElement"]);
                setSelectedElement(safeElement);
                setSelectedElementSource(safeElement ? "edit-media" : null);
                if (!safeElement) {
                    setMediaToolsOpen(false);
                }
                return;
            }
            if (event.data.type === "pf-edit-save") {
                // Triggered when user confirms save from EDIT Light mode
                const html = String(event.data.html ?? "");
                pendingEditHtmlRef.current = html;
                void handleCommitEditVersionRef.current(html);
            }
            if (event.data.type === "pf-edit-media-list") {
                // Map iframe-scanned items to the reusable MediaItem shape.
                // Protected project asset URLs are resolved with auth; generated data URLs must stay intact.
                const raw: Array<{ selector: string; stableNodeId: string; tag: string; src: string; alt: string; mediaMode: string; w: number; h: number }> =
                    Array.isArray(event.data.items) ? event.data.items : [];

                void (async () => {
                    const items = await Promise.all(
                        raw.map(async (r) => ({
                            id: r.stableNodeId || r.selector,
                            src: await resolveSidebarMediaSrc(r.src),
                            alt: r.alt,
                            label: r.tag,
                            mediaType: r.mediaMode === "background" ? "background" as const : "image" as const,
                            width: r.w,
                            height: r.h,
                            meta: { selector: r.selector, stableNodeId: r.stableNodeId },
                        })),
                    );

                    setEditMediaList(items);
                })();
            }
        }
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [resolveSidebarMediaSrc]);

    useEffect(() => {
        if (!hasPreviewArtifacts && inspectMode) {
            setInspectMode(false);
            clearSelectedElement();
        }
    }, [clearSelectedElement, hasPreviewArtifacts, inspectMode]);

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
            clearSelectedElement();
            setEditMediaList([]);
            return;
        }

        setInspectMode(false);
        clearSelectedElement();

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
    }, [token, activeConvId, editMode, selectedBackendSnapshotId, projectId, editorHtml, editorCss, editorJs, clearSelectedElement]);

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
            addNotification({ label: t("workspace.notifications.snapshot.editSavedLabel"), status: "done", message: t("workspace.notifications.snapshot.editSaved") });
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
        setEditorSelectionLabel("");
        setCodeEditorSelection(null);
        // Clear the selected element when the active snapshot changes.
        // data-pf-id values are snapshot-version-specific: if the snapshot HTML was
        // rebuilt or a focused patch replaced the root element, the element gets a new
        // ID. Keeping the old outerHtml (with the stale ID) would make Strategy 0 fail
        // on the next focused-edit turn because the ID is no longer present in the base.
        clearSelectedElement();
    }, [artifactsKey, artifacts?.html, artifacts?.css, artifacts?.js, clearSelectedElement]);

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
    const currentProviderMissingKey = Boolean(currentProvider?.requiresKey && !currentProvider.hasApiKeyConfigured);
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

    const presentLlmError = useCallback((err: unknown): string => {
        const fallbackMessage = err instanceof Error ? err.message : String(err);

        if (!(err instanceof ApiError)) {
            addNotification({
                label: t("workspace.notifications.llm.errorLabel"),
                status: "error",
                message: fallbackMessage,
            });
            return fallbackMessage;
        }

        const provider = getStringDetail(err.details, "provider") ?? currentProvider?.provider ?? undefined;
        const model = getStringDetail(err.details, "model") ?? (selectedModel || undefined);
        const keyEnvironmentVariable = getStringDetail(err.details, "keyEnvironmentVariable");
        const rawMessage = err.userMessage ?? err.message;
        const looksLikeValidationOverflow = err.code === "VALIDATION_ERROR"
            || /request validation failed|campi della richiesta non sono validi/i.test(rawMessage);
        const message = looksLikeValidationOverflow
            ? "Contesto troppo lungo o risposta troppo pesante per questa richiesta. Ho ridotto la memoria inviata: riprova con l'ultima azione."
            : rawMessage;
        const title = err.code === "LLM_PROVIDER_API_KEY_MISSING"
            ? "Configura la API key del provider"
            : looksLikeValidationOverflow
                ? "Contesto troppo lungo"
                : "Errore durante la chiamata al provider";
        const shouldOpenDialog = Boolean(err.code?.startsWith("LLM_") || looksLikeValidationOverflow);

        addNotification({
            label: err.code === "LLM_PROVIDER_API_KEY_MISSING" ? "Provider non configurato" : "Errore LLM",
            status: "error",
            message,
        });

        if (shouldOpenDialog) {
            setLlmErrorDialog({
                title,
                message,
                code: err.code,
                provider,
                model,
                keyEnvironmentVariable,
            });
        }

        return `Errore [${err.status}]: ${message}`;
    }, [addNotification, currentProvider?.provider, selectedModel]);

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

    useEffect(() => {
        if (!isDraggingVChat) return;
        function onMove(e: MouseEvent) {
            const body = chatBodyRef.current;
            if (!body) return;
            const rect = body.getBoundingClientRect();
            const pct = Math.min(85, Math.max(30, ((e.clientY - rect.top) / rect.height) * 100));
            setChatVSplit(pct);
            chatVSplitRef.current = pct;
        }
        function onUp() {
            setIsDraggingVChat(false);
            setCookie(CHAT_VSPLIT_COOKIE, String(Math.round(chatVSplitRef.current)));
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
    }, [isDraggingVChat]);

    useEffect(() => {
        if (llmErrorDialog?.code === "LLM_PROVIDER_API_KEY_MISSING" && !currentProviderMissingKey) {
            setLlmErrorDialog(null);
        }
    }, [currentProviderMissingKey, llmErrorDialog?.code]);

    async function handleSend(e: React.FormEvent) {
        e.preventDefault();
        const content = prompt.trim();
        if (!content || !token || sending || conversationLoading) return;

        setPrompt("");
        setSending(true);
        setActiveOperation("chat");
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
        const notifId = addNotification({
            label: inspectMode ? "Generazione AI con focus" : "Generazione AI",
            status: "running",
            message: inspectMode
                ? "Sto elaborando la richiesta e aggiornando la preview…"
                : "Sto elaborando la richiesta…",
        });

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

            // Build a compact conversation history for the backend.
            // Long conversations and full artifact payloads can push the request over the
            // provider/validation budget, so we always keep only a small, recent memory window.
            const historyMaxMessages = Math.max(2, Math.min(chatDefaults.historyMaxMessages ?? 8, inspectMode ? 6 : 8));
            const historyMessageMaxChars = Math.max(300, Math.min(chatDefaults.historyMessageMaxChars ?? 1200, inspectMode ? 900 : 1200));
            const history = (activeConv?.messages ?? [])
                .filter((m): m is MessageDto & { role: "user" | "assistant" } =>
                    m.role === "user" || m.role === "assistant"
                )
                .slice(-historyMaxMessages)
                .map((m) => {
                    if (m.role === "assistant") {
                        const s = m.metadata?.chatStructured;
                        const compact = s
                            ? [s.summary, ...(s.bullets ?? [])].filter(Boolean).join(" | ")
                            : m.content;
                        return { role: "assistant" as const, content: compact.trim().slice(0, historyMessageMaxChars) };
                    }
                    return { role: "user" as const, content: m.content.trim().slice(0, historyMessageMaxChars) };
                })
                .filter((m) => m.content.length > 0);

            const currentArtifactsSource =
                editorHtml || editorCss || editorJs
                    ? { html: editorHtml, css: editorCss, js: editorJs }
                    : activeBaselineSnapshot?.artifacts ?? latestAssistant?.metadata?.generatedArtifacts;
            // In focused edit mode the server needs the full HTML for section extraction
            // and patch merging (data-pf-id lookup). Use Zod schema max (80K/20K/20K)
            // for focus; server-side buildMessagesWithHistory truncates for the LLM prompt.
            // 80K accommodates base HTML + data-pf-id overhead + GrapesJS inflation.
            const isFocusedRequest = inspectMode && !!selectedElement;
            const htmlLimit = isFocusedRequest ? 80000 : 20000;
            const cssLimit = isFocusedRequest ? 20000 : 10000;
            const jsLimit = isFocusedRequest ? 20000 : 10000;
            const currentArtifacts = currentArtifactsSource
                ? {
                    html: (currentArtifactsSource.html ?? "").slice(0, htmlLimit),
                    css: (currentArtifactsSource.css ?? "").slice(0, cssLimit),
                    js: (currentArtifactsSource.js ?? "").slice(0, jsLimit),
                }
                : undefined;

            // Build focusContext from active inspect selection or code editor selection
            const focusContext: LlmFocusContext | undefined = (() => {
                if (inspectMode) {
                    const safeSelectedElement = sanitizeSelectedElementForFocus(selectedElement);
                    if (safeSelectedElement) {
                        return {
                            mode: "preview-element" as const,
                            targetType: getElementTargetType(safeSelectedElement.tag, safeSelectedElement.mediaMode),
                            userIntent: content,
                            selectedElement: safeSelectedElement,
                        };
                    }
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

            if (currentProvider?.requiresKey && !currentProvider.hasApiKeyConfigured) {
                throw new ApiError(503, {
                    error: `Il provider ${currentProvider.provider} richiede una API key che non e configurata.`,
                    code: "LLM_PROVIDER_API_KEY_MISSING",
                    status: 503,
                    userMessage: `Il provider ${currentProvider.provider} richiede una API key che non e configurata.`,
                    details: {
                        provider: currentProvider.provider,
                        model: selectedModel || undefined,
                        keyEnvironmentVariable: currentProvider.keyEnvironmentVariable,
                    },
                });
            }

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
                            throw new ApiError(event.error?.status ?? 502, event.error ?? { error: event.message });
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
                    updateNotification(notifId, {
                        label: t("workspace.notifications.llm.abortedLabel"),
                        status: "error",
                        message: t("workspace.notifications.llm.aborted"),
                    });
                    setThinkingText("");
                    setDraftAnswer("");
                    return;
                }
                const retryWithoutFocusContext = Boolean(focusContext && isFocusContextValidationError(streamErr));

                if (retryWithoutFocusContext) {
                    clearSelectedElement();
                    addNotification({
                        label: t("workspace.notifications.focusPatch.limitedLabel"),
                        status: "error",
                        message: t("workspace.notifications.focusPatch.limited"),
                    });
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
                    focusContext: retryWithoutFocusContext ? undefined : focusContext,
                });
            }

            const assistantContent = (llm.reply?.trim()
                || llm.structured?.chat?.summary?.trim()
                || "Risposta AI generata senza testo visibile.").slice(0, 50000);

            const assistantSaved = await addMessage(token, projectId, convId, {
                role: "assistant",
                content: assistantContent,
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
                prev
                    ? {
                        ...prev,
                        totalTokens: prev.totalTokens + (llm.usage?.totalTokens ?? 0),
                        totalCost: (prev.totalCost ?? 0) + (llm.costEstimate?.amount ?? 0),
                        messages: [...prev.messages, assistantSaved.message],
                    }
                    : prev
            );

            // Keep promptOpsSummary in sync so the workspace header total cost
            // reflects chat costs immediately (backend now writes chat to PromptExecutionLog).
            setPromptOpsSummary((prev) => ({
                totalCost: prev.totalCost + (llm.costEstimate?.amount ?? 0),
                totalTokens: prev.totalTokens + (llm.usage?.totalTokens ?? 0),
                runs: prev.runs + 1,
            }));

            let previewVersionSaved = false;

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
                    // Use snapshot artifacts (which have data-pf-id injected by the server)
                    // instead of the raw LLM response so the iframe DOM and the next
                    // request's currentArtifacts include stable IDs for focused editing.
                    const snapArt = snap.snapshot.artifacts;
                    setPreviewSnapshots(freshSnapshots);
                    setSelectedBackendSnapshotId(snap.snapshot.id);
                    setEditorHtml(snapArt?.html ?? llm.structured.artifacts.html ?? "");
                    setEditorCss(snapArt?.css ?? llm.structured.artifacts.css ?? "");
                    setEditorJs(snapArt?.js ?? llm.structured.artifacts.js ?? "");
                    // Spinner cleared by iframe onLoad; fallback timeout in case user is on another tab
                    setPreviewRefreshing(true);
                    setPreviewPending(true);
                    setTimeout(() => {
                        setPreviewRefreshing(false);
                    }, 3000);
                    previewVersionSaved = true;
                } catch {
                    // non-blocking — UI works without snapshot persistence
                }
            }

            // When focused-mode JSON parsing failed entirely, notify the user
            // and suggest switching model — the page was left untouched.
            if (llm.focusPatchParseError && focusContext?.mode === "preview-element") {
                clearSelectedElement();
                setEditorSelectionLabel("");
                addNotification({
                    label: t("workspace.notifications.focusPatch.parseErrorLabel"),
                    status: "error",
                    message: t("workspace.notifications.focusPatch.parseError"),
                });
            }

            // Inform the user when a focused-patch merge failed on the server.
            // This happens when the element's data-pf-id is stale (e.g. the active
            // snapshot was replaced without the element being re-selected) and all
            // text-matching fallbacks also failed.  The selection is cleared so the
            // next focused-edit starts fresh with a valid anchor.
            if (llm.focusPatchApplied === false && focusContext?.mode === "preview-element") {
                clearSelectedElement();
                setEditorSelectionLabel("");
                addNotification({
                    label: t("workspace.notifications.focusPatch.notAppliedLabel"),
                    status: "error",
                    message: t("workspace.notifications.focusPatch.notApplied"),
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

            updateNotification(notifId, {
                label: llm.focusPatchParseError
                    ? t("workspace.notifications.focusPatch.parseResponseLabel")
                    : llm.focusPatchApplied
                        ? t("workspace.notifications.focusPatch.appliedLabel")
                        : previewVersionSaved
                            ? t("workspace.notifications.snapshot.newVersionLabel")
                            : t("workspace.notifications.llm.doneLabel"),
                status: llm.focusPatchParseError ? "error" : "done",
                message: llm.focusPatchParseError
                    ? t("workspace.notifications.focusPatch.parseResponseMessage")
                    : llm.focusPatchApplied
                        ? t("workspace.notifications.focusPatch.appliedMessage")
                        : previewVersionSaved
                            ? t("workspace.notifications.snapshot.newVersionMessage")
                            : t("workspace.notifications.llm.doneMessage", { provider: llm.provider, model: llm.model }),
            });

            setThinkingText("");
            setDraftAnswer("");
        } catch (err) {
            const msg = presentLlmError(err);
            setError(msg);
            updateNotification(notifId, {
                label: t("workspace.notifications.llm.abortedLabel"),
                status: "error",
                message: msg,
            });

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
            setActiveOperation(null);
        }
    }

    async function handleOptimizePrompt() {
        if (!token || !prompt.trim() || optimizingPrompt || conversationLoading) return;

        const original = prompt.trim();
        let trackedConversationId: string | null = activeConvId;
        let trackedUserMessageId: string | null = null;
        const notifId = addNotification({
            label: t("workspace.notifications.promptOptimizer.label"),
            status: "running",
            message: t("workspace.notifications.promptOptimizer.running"),
        });
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        setOptimizingPrompt(true);
        setActiveOperation("prompt-optimizer");
        setError(null);
        setThinkingText("");
        setDraftAnswer("");
        setIsUserScrolled(false);
        setStreamPromptTokens(Math.max(1, Math.round(original.length / 4)));
        setStreamUsageTokens(null);

        try {
            const convId = activeConvId;
            if (!convId) {
                throw new Error("Conversation not loaded yet");
            }

            const userSaved = await addMessage(token, projectId, convId, {
                role: "user",
                content: original,
                metadata: {
                    operation: {
                        kind: "prompt_optimizer_request",
                        mode: "operational",
                        target: "input",
                        label: t("workspace.notifications.promptOptimizer.inputLabel"),
                        suppressArtifacts: true,
                    },
                },
            });
            trackedConversationId = convId;
            trackedUserMessageId = userSaved.message.id;
            setActiveConv((prev) =>
                prev ? { ...prev, messages: [...prev.messages, userSaved.message] } : prev
            );

            let finalResult: {
                optimizedPrompt: string;
                provider: string;
                model: string;
                usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
                costEstimate?: {
                    currency: "EUR";
                    amount: number;
                    breakdown: { tokenCost: number; imageCost: number; videoCost: number };
                    unitRates: { textEurPer1kTokens: number; imageEurPerAsset: number; videoEurPerAsset: number };
                    providerCostUsd?: number;
                };
                durationMs: number;
                skipped?: boolean;
                rawResponse?: string;
                finishReason?: string;
                promptingTrace?: {
                    originalUserMessage: string;
                    effectiveSystemPrompt: string;
                    messagesSentToLlm: Array<{ role: "system" | "user"; content: string }>;
                };
            } | null = null;

            await streamOptimizePrompt(
                token,
                projectId,
                {
                    rawPrompt: original,
                    conversationId: convId,
                    provider: selectedProvider || undefined,
                    model: selectedModel || undefined,
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
                        finalResult = event.result;
                        if (event.result.usage) {
                            setStreamUsageTokens(event.result.usage);
                        }
                        return;
                    }

                    if (event.type === "error") {
                        throw new ApiError(event.error?.status ?? 502, event.error ?? { error: event.message });
                    }
                },
                abortController.signal
            );

            if (!finalResult) {
                throw new Error("Optimizer stream ended without final payload");
            }

            const result = finalResult;
            setPromptRestoreValue(original);
            setPrompt(result.optimizedPrompt);
            setPromptOpsSummary((prev) => ({
                totalCost: prev.totalCost + (result.costEstimate?.amount ?? 0),
                totalTokens: prev.totalTokens + (result.usage?.totalTokens ?? 0),
                runs: prev.runs + (result.skipped ? 0 : 1),
            }));

            const assistantSaved = await addMessage(token, projectId, convId, {
                role: "assistant",
                content: (result.optimizedPrompt?.trim() || "Prompt ottimizzato pronto.").slice(0, 50000),
                metadata: {
                    model: result.model,
                    provider: result.provider,
                    executionTimeMs: result.durationMs,
                    finishReason: result.finishReason,
                    rawResponse: result.rawResponse,
                    promptingTrace: result.promptingTrace as MessageDto["metadata"]["promptingTrace"],
                    tokenUsage: result.usage,
                    costEstimate: result.costEstimate,
                    operation: {
                        kind: "prompt_optimizer",
                        mode: "operational",
                        target: "input",
                        label: t("workspace.notifications.promptOptimizer.outputLabel"),
                        suppressArtifacts: true,
                    },
                },
            });

            setActiveConv((prev) =>
                prev
                    ? {
                        ...prev,
                        totalTokens: prev.totalTokens + (result.usage?.totalTokens ?? 0),
                        totalCost: (prev.totalCost ?? 0) + (result.costEstimate?.amount ?? 0),
                        messages: [...prev.messages, assistantSaved.message],
                    }
                    : prev
            );

            if (trackedUserMessageId) {
                await logBackgroundTask(token, projectId, convId, trackedUserMessageId, {
                    type: "prompt_optimizer",
                    pipelineProfile: "optimizer-stream",
                    input: { prompt: original },
                    output: {
                        provider: result.provider,
                        model: result.model,
                        durationMs: result.durationMs,
                        target: "input",
                        optimizedPrompt: result.optimizedPrompt,
                    },
                    tokenUsage: result.usage,
                    costEstimate: result.costEstimate,
                    status: "completed",
                });
            }

            updateNotification(notifId, {
                status: "done",
                message: result.skipped
                    ? t("workspace.notifications.promptOptimizer.skipped")
                    : t("workspace.notifications.promptOptimizer.done", { provider: result.provider, model: result.model }),
            });
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                updateNotification(notifId, { label: t("workspace.notifications.promptOptimizer.label"), status: "error", message: t("workspace.notifications.promptOptimizer.aborted") });
                if (token && trackedConversationId) {
                    try {
                        const interruptedSaved = await addMessage(token, projectId, trackedConversationId, {
                            role: "assistant",
                            content: t("workspace.notifications.promptOptimizer.abortedContent"),
                            metadata: {
                                operation: {
                                    kind: "prompt_optimizer",
                                    mode: "operational",
                                    target: "input",
                                    label: t("workspace.notifications.promptOptimizer.outputLabel"),
                                    suppressArtifacts: true,
                                },
                            },
                        });
                        setActiveConv((prev) =>
                            prev ? { ...prev, messages: [...prev.messages, interruptedSaved.message] } : prev
                        );
                    } catch {
                        // non-blocking
                    }
                }
                return;
            }

            const msg = err instanceof ApiError ? presentLlmError(err) : err instanceof Error ? err.message : "Prompt optimization failed";
            setError(msg);

            if (token && trackedConversationId) {
                try {
                    const errorSaved = await addMessage(token, projectId, trackedConversationId, {
                        role: "error",
                        content: `Optimize prompt: ${msg}`,
                    });
                    setActiveConv((prev) =>
                        prev ? { ...prev, messages: [...prev.messages, errorSaved.message] } : prev
                    );
                } catch {
                    // keep initial error only
                }
            }

            if (token && trackedConversationId && trackedUserMessageId) {
                try {
                    await logBackgroundTask(token, projectId, trackedConversationId, trackedUserMessageId, {
                        type: "prompt_optimizer",
                        pipelineProfile: "optimizer-stream",
                        input: { prompt: original },
                        error: msg,
                        status: "failed",
                    });
                } catch {
                    // non-blocking
                }
            }

            updateNotification(notifId, { label: t("workspace.notifications.promptOptimizer.label"), status: "error", message: msg });
        } finally {
            abortControllerRef.current = null;
            setThinkingText("");
            setDraftAnswer("");
            setOptimizingPrompt(false);
            setActiveOperation(null);
        }
    }

    function handleRestoreOptimizedPrompt() {
        if (!promptRestoreValue) return;
        setPrompt(promptRestoreValue);
        setPromptRestoreValue(null);
    }

    useEffect(() => {
        if (typeof window === "undefined") return;
        setVoiceSupported(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));

        return () => {
            speechRecognitionRef.current?.abort();
            speechRecognitionRef.current = null;
        };
    }, []);

    const handleToggleVoiceInput = useCallback(() => {
        if (voiceListening) {
            speechRecognitionRef.current?.stop();
            return;
        }

        if (typeof window === "undefined") return;

        const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!RecognitionCtor) {
            setVoiceSupported(false);
            setVoiceError("Dettatura disponibile solo in Chrome o Edge compatibili.");
            return;
        }

        const recognition = speechRecognitionRef.current ?? new RecognitionCtor();
        speechRecognitionRef.current = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = document.documentElement.lang?.trim() || navigator.languages?.[0] || navigator.language || "it-IT";

        recognition.onstart = () => {
            speechBasePromptRef.current = prompt;
            speechCommittedTranscriptRef.current = "";
            setVoiceListening(true);
            setVoiceError(null);
        };

        recognition.onresult = (event: BrowserSpeechRecognitionEvent) => {
            let finalTranscript = "";
            let interimTranscript = "";

            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const transcript = event.results[i]?.[0]?.transcript ?? "";
                if (event.results[i]?.isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            if (finalTranscript) {
                speechCommittedTranscriptRef.current = appendPromptSegment(
                    speechCommittedTranscriptRef.current,
                    finalTranscript
                );
            }

            const liveTranscript = appendPromptSegment(
                speechCommittedTranscriptRef.current,
                interimTranscript
            );

            setPrompt(appendPromptSegment(speechBasePromptRef.current, liveTranscript));
        };

        recognition.onerror = (event: BrowserSpeechRecognitionErrorEvent) => {
            if (event.error && event.error !== "aborted" && event.error !== "no-speech") {
                setVoiceError(`Dettatura non disponibile: ${event.error}.`);
            }
            setVoiceListening(false);
        };

        recognition.onend = () => {
            setVoiceListening(false);
        };

        try {
            recognition.start();
        } catch {
            setVoiceError("Microfono già in uso o permesso non concesso.");
            setVoiceListening(false);
        }
    }, [prompt, voiceListening]);

    function handleStop() {
        speechRecognitionRef.current?.stop();
        abortControllerRef.current?.abort();
    }

    if (checkingAuth) {
        return <div style={{ padding: "2rem", color: "var(--text-muted)" }}>Verifica sessione…</div>;
    }

    return (
        <div className="workspace-outer">
        <WorkspaceHeader
            projectName={projectName}
            totalCostEur={promptOpsSummary.totalCost + (projectAiAnalytics?.totals.imageCost ?? 0)}
            onConfigOpen={() => setConfigOpen(true)}
            onDashboard={() => router.push("/dashboard")}
        />
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
                        <select
                            style={controlSelectStyle}
                            value={selectedProvider}
                            onChange={(e) => setSelectedProvider(e.target.value)}
                            disabled={providersCatalog.length === 0 || sending || optimizingPrompt}
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
                            disabled={!currentProvider || currentProviderModels.length === 0 || sending || optimizingPrompt}
                        >
                            {currentProviderModels.length === 0 ? (
                                <option value="">Model</option>
                            ) : (
                                groupedModelOptions(currentProviderModels)
                            )}
                        </select>
                    </div>
                    {currentProviderMissingKey && currentProvider && (
                        <div
                            style={{
                                marginTop: "0.6rem",
                                border: "1px solid rgba(239, 68, 68, 0.35)",
                                background: "rgba(239, 68, 68, 0.08)",
                                color: "#fca5a5",
                                borderRadius: "0.5rem",
                                padding: "0.65rem 0.75rem",
                                fontSize: "0.78rem",
                                lineHeight: 1.45,
                            }}
                        >
                            Il provider <strong>{currentProvider.provider}</strong> richiede una API key non configurata.
                            {currentProvider.keyEnvironmentVariable ? ` Configura ${currentProvider.keyEnvironmentVariable} e riprova.` : " Configura la chiave del provider e riprova."}
                        </div>
                    )}
                    {!currentProviderMissingKey && currentProvider && selectedModel && (
                        <p className="mt-2 text-xs text-muted-foreground">
                            Optimize prompt usa <strong className="text-foreground">{selectedProvider} · {selectedModel.split("/").pop()}</strong>
                        </p>
                    )}
                </div>

                <div ref={chatBodyRef} className="workspace-chat-body">
                <div className="workspace-chat-messages" ref={chatContainerRef} style={{ height: `${Math.round(chatVSplit)}%` }}>
                    {conversationLoading && (
                        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", padding: "0.5rem" }}>
                            Caricamento conversazione…
                        </p>
                    )}
                    {activeConv?.messages.map((msg) => (
                        <MessageBubble key={msg.id} message={msg} />
                    ))}

                    {(sending || optimizingPrompt) && (
                        <div className="workspace-stream-box">
                            <div className="workspace-stream-title">
                                {activeOperation === "prompt-optimizer"
                                    ? (draftAnswer ? "Ottimizzazione prompt in corso..." : thinkingText ? "Analisi optimizer..." : "Connessione optimizer...")
                                    : (draftAnswer ? "Risposta in corso..." : thinkingText ? "Ragionamento..." : "Connessione al provider...")}
                            </div>
                            <div ref={thinkingFlowRef} className="workspace-thinking-flow">
                                {thinkingText || (activeOperation === "prompt-optimizer" ? "Sto elaborando il prompt nel flusso conversazionale..." : "In attesa del ragionamento stream...")}
                            </div>
                            {draftAnswer && (
                                <div className="workspace-draft-box">
                                    <pre className="workspace-draft-inner">{draftAnswer}</pre>
                                </div>
                            )}
                            <div className="workspace-stream-footer">
                                <div className="workspace-thinking-spinner">
                                    <span className="workspace-spinner-dot" />
                                    {activeOperation === "prompt-optimizer" ? "ottimizzo il prompt..." : "sto pensando..."}
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
                <div
                    className="workspace-chat-vresizer"
                    onMouseDown={() => setIsDraggingVChat(true)}
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize chat input"
                />
                <form onSubmit={(e) => void handleSend(e)} className="workspace-input-form">
                    <div className="flex items-start gap-2">
                        <textarea
                            style={textareaStyle}
                            className={inspectMode && selectedElement ? "placeholder:italic" : undefined}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    void handleSend(e as unknown as React.FormEvent);
                                }
                            }}
                            placeholder={inspectMode && selectedElement
                                ? (mediaMode === "background"
                                    ? "Descrivi qui la modifica focus patch per il background selezionato..."
                                    : "Descrivi qui la modifica focus patch per l'elemento selezionato...")
                                : "Scrivi cosa vuoi realizzare..."}
                            rows={3}
                            disabled={sending || optimizingPrompt}
                        />
                        <Button
                            type="button"
                            variant={voiceListening ? "destructive" : "outline"}
                            size="icon"
                            onClick={handleToggleVoiceInput}
                            disabled={!voiceSupported || sending || conversationLoading || optimizingPrompt}
                            title={voiceListening ? "Ferma la dettatura" : "Detta il prompt con il microfono"}
                            aria-label={voiceListening ? "Ferma dettatura" : "Avvia dettatura"}
                            className="shrink-0"
                        >
                            {voiceListening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        </Button>
                    </div>
                    {(voiceSupported || voiceError) && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{voiceListening ? "🎙️ Ascolto in corso…" : "Chrome: dettatura vocale pronta"}</span>
                            {voiceError && <span className="text-destructive">{voiceError}</span>}
                        </div>
                    )}
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
                                onClick={clearSelectedElement}
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
                    {token && inspectMode && !selectedElement && previewTab === "preview" && hasPreviewArtifacts && (
                        <div style={{
                            border: "1px dashed var(--border)",
                            borderRadius: "var(--radius)",
                            padding: "0.65rem 0.8rem",
                            fontSize: "0.78rem",
                            color: "var(--text-muted)",
                            background: "rgba(99,102,241,0.06)",
                        }}>
                            Clicca un elemento nella preview per selezionarlo. Per le immagini puoi cliccare direttamente la foto; con Shift o Alt selezioni il contenitore più ampio.
                        </div>
                    )}
                    {token && editMode && selectedElementSource === "edit-media" && selectedElement && previewTab === "preview" && (
                        <div className="mt-2 space-y-3 rounded-lg border border-border bg-card/60 p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Image tools in EDIT</p>
                                    <p className="truncate text-[11px] text-muted-foreground">{selectedElement.selector}</p>
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                        In EDIT, text keeps priority. Click directly on the image area to target the media underneath.
                                    </p>
                                </div>
                                <Button type="button" variant="ghost" size="sm" onClick={clearSelectedElement}>
                                    Chiudi
                                </Button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => {
                                        setMediaInspectorSection("gen-image");
                                        setMediaToolsOpen(true);
                                        void handleSuggestMedia();
                                    }}
                                    disabled={generatingMedia || suggestingMedia}
                                >
                                    {(generatingMedia || suggestingMedia) ? "Elaborazione…" : "Gen image AI"}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        setMediaInspectorSection("gallery");
                                        setMediaToolsOpen(true);
                                    }}
                                >
                                    Image Gallery
                                </Button>
                            </div>
                        </div>
                    )}
                    <Dialog
                        open={Boolean(mediaToolsOpen && token && editMode && selectedElementSource === "edit-media" && selectedElement && previewTab === "preview")}
                        onOpenChange={setMediaToolsOpen}
                    >
                        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle>Image AI tools</DialogTitle>
                                <DialogDescription>
                                    Manual generation and advanced image settings are separated from the chat and available only inside EDIT mode.
                                </DialogDescription>
                            </DialogHeader>
                            {token && editMode && selectedElementSource === "edit-media" && selectedElement && previewTab === "preview" && (
                                <MediaInspectorPanel
                                    token={token}
                                    projectId={projectId}
                                    selectedElement={selectedElement}
                                    assets={projectAssets}
                                    loadingAssets={loadingProjectAssets}
                                    chatPromptPlaceholder={mediaMode === "background"
                                        ? "Use an optional manual prompt or ask for a semantic suggestion for this background…"
                                        : "Use an optional manual prompt or ask for a semantic suggestion for this image…"}
                                    assetScope={assetScope}
                                    onAssetScopeChange={setAssetScope}
                                    mediaMode={mediaMode}
                                    onMediaModeChange={setMediaMode}
                                    backgroundFit={backgroundFit}
                                    onBackgroundFitChange={setBackgroundFit}
                                    backgroundRepeat={backgroundRepeat}
                                    onBackgroundRepeatChange={setBackgroundRepeat}
                                    mediaOpacity={mediaOpacity}
                                    onMediaOpacityChange={setMediaOpacity}
                                    mediaFilter={mediaFilter}
                                    onMediaFilterChange={setMediaFilter}
                                    generating={generatingMedia}
                                    suggesting={suggestingMedia}
                                    suggestion={mediaSuggestion}
                                    imageModelOptions={imageModelOptions}
                                    selectedImageModel={selectedImageModel}
                                    onImageModelChange={setSelectedImageModel}
                                    imageSize={selectedImageSize}
                                    onImageSizeChange={setSelectedImageSize}
                                    imageSteps={selectedImageSteps}
                                    onImageStepsChange={setSelectedImageSteps}
                                    aiAnalytics={projectAiAnalytics}
                                    loadingAiAnalytics={loadingAiAnalytics}
                                    initialSection={mediaInspectorSection}
                                    onGenerateWithPrompt={(p) => {
                                        setPrompt(p);
                                        void runMediaGeneration(p.slice(0, 2000), { label: t("workspace.notifications.imageGeneration.label") });
                                        setMediaToolsOpen(false);
                                    }}
                                    onOpenGallery={() => setConfigOpen(true)}
                                    onApplyAsset={(asset) => void handleApplyAsset(asset)}
                                    onApplyCurrentStyles={handleApplyCurrentStyles}
                                />
                            )}
                        </DialogContent>
                    </Dialog>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <div className="row" style={{ gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                            <RequestMetaInfo message={latestAssistant} variant="global" />
                            {promptOpsSummary.runs > 0 && (
                                <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                                    optimizer: {promptOpsSummary.runs} run{promptOpsSummary.runs === 1 ? "" : "s"} · {formatCostEur(promptOpsSummary.totalCost) || "€0"}
                                </span>
                            )}
                        </div>
                        <div className="row" style={{ gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => void handleOptimizePrompt()}
                                disabled={!prompt.trim() || sending || conversationLoading || optimizingPrompt || currentProviderMissingKey}
                                title={selectedModel ? `Usa ${selectedProvider} · ${selectedModel}` : "Usa il provider/modello attivo della chat"}
                            >
                                {optimizingPrompt
                                    ? "Optimizing..."
                                    : selectedModel
                                        ? `Optimize · ${selectedModel.split("/").pop()}`
                                        : "Optimize prompt"}
                            </Button>
                            {promptRestoreValue && (
                                <Button type="button" variant="outline" onClick={handleRestoreOptimizedPrompt} disabled={sending || optimizingPrompt}>
                                    Restore original
                                </Button>
                            )}
                            {(sending || optimizingPrompt) && (
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
                            <button type="submit" disabled={!prompt.trim() || sending || conversationLoading || optimizingPrompt}>{sending ? "Invio..." : "Invia"}</button>
                        </div>
                    </div>
                </form>
                </div>{/* /workspace-chat-body */}
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
                    {/* LEFT: version/quality badges */}
                    <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap", alignItems: "center", flex: 1, minWidth: 0 }}>
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
                    {/* RIGHT: export/capture/publish action buttons */}
                    <div className="row" style={{ gap: "0.3rem", alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
                        {artifacts && (
                            <button
                                type="button"
                                className="secondary"
                                disabled={exportState === "loading"}
                                onClick={handleExportLayer1}
                                style={{ fontSize: "0.72rem", padding: "0.18rem 0.5rem" }}
                                title={exportState === "error" ? (exportError ?? "Errore export") : "Esporta HTML/CSS/JS come ZIP"}
                            >
                                {exportState === "loading" ? "⏳" : "⬇ ZIP"}
                            </button>
                        )}
                        {artifacts && (
                            <div ref={captureDropdownRef} style={{ position: "relative" }}>
                                <button
                                    type="button"
                                    className="secondary"
                                    disabled={captureState === "loading"}
                                    onClick={() => setCaptureDropdownOpen((v) => !v)}
                                    style={{ fontSize: "0.72rem", padding: "0.18rem 0.5rem" }}
                                    title="Cattura screenshot JPG o PDF della preview"
                                >
                                    {captureState === "loading" ? "⏳" : captureState === "error" ? "⚠" : "📷"}
                                </button>
                                {captureDropdownOpen && (
                                    <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 300, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", boxShadow: "0 8px 24px rgba(0,0,0,0.28)", minWidth: 130, overflow: "hidden" }}>
                                        {(["jpg", "pdf"] as const).map((fmt) => (
                                            <button
                                                key={fmt}
                                                type="button"
                                                onClick={() => void handleCaptureSnapshot(fmt)}
                                                style={{ display: "block", width: "100%", background: "transparent", border: "none", borderBottom: fmt === "jpg" ? "1px solid var(--border)" : "none", color: "var(--text)", padding: "0.5rem 0.8rem", textAlign: "left", cursor: "pointer", fontSize: "0.8rem" }}
                                                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                                                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                                            >
                                                {fmt === "jpg" ? "🖼 JPG" : "📄 PDF"}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        {artifacts && (
                            <button
                                type="button"
                                className="secondary"
                                disabled={publishState === "loading"}
                                onClick={handlePublish}
                                style={{ fontSize: "0.72rem", padding: "0.18rem 0.5rem" }}
                                title={publishDeployment ? "Aggiorna pubblicazione live" : "Pubblica con link condivisibile"}
                            >
                                {publishState === "loading" ? "⏳" : publishState === "error" ? "⚠ Errore" : publishDeployment ? "🔄 Aggiorna" : "🌐 Pubblica"}
                            </button>
                        )}
                        {/* Version history — inline in header, right of action buttons */}
                        {(previewSnapshots.length > 0 || loadingSnapshots) && (
                            <>
                                <div style={{ width: "1px", height: "18px", background: "var(--border)", margin: "0 0.1rem", flexShrink: 0 }} />
                                <SnapshotHistoryPanel
                                    snapshots={previewSnapshots}
                                    selectedId={selectedBackendSnapshotId}
                                    loading={loadingSnapshots}
                                    onSelect={(id) => {
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
                                            addNotification({ label: t("workspace.notifications.snapshot.activatedLabel"), status: "done", message: t("workspace.notifications.snapshot.activated") });
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
                            </>
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
                                        background: "#7dd3fc",
                                        boxShadow: "0 0 5px #7dd3fc",
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
                                disabled={!hasPreviewArtifacts}
                                onClick={() => {
                                    if (!hasPreviewArtifacts) return;
                                    const next = !inspectMode;
                                    setInspectMode(next);
                                    clearSelectedElement();
                                    // Disable EDIT mode when Inspect is activated
                                    if (next && editMode) setEditMode(false);
                                }}
                                style={{ marginLeft: "auto", fontSize: "0.74rem", padding: "0.2rem 0.6rem", opacity: hasPreviewArtifacts ? 1 : 0.5, cursor: hasPreviewArtifacts ? "pointer" : "not-allowed" }}
                                title={hasPreviewArtifacts
                                    ? (inspectMode ? "Disattiva Inspect" : "Attiva Inspect: seleziona un elemento e usa solo il flow focus patch in chat")
                                    : "Inspect disponibile solo quando la preview contiene codice generato"}
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
                                    title={editMode ? "Disattiva EDIT Light" : "Attiva EDIT Light: clicca il testo per modificarlo o un'immagine per aprire gli strumenti AI"}
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
                            {editorSelectionLabel || t("workspace.selectionNone")}
                        </span>
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
                            background: isPublishStale ? "rgba(245,158,11,0.07)" : "rgba(125,211,252,0.08)",
                            borderBottom: isPublishStale ? "1px solid rgba(245,158,11,0.25)" : "1px solid rgba(125,211,252,0.20)",
                            fontSize: "0.78rem",
                            color: "#7dd3fc",
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
                                    style={{ color: "#7dd3fc", textDecoration: "underline" }}
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
                                style={{ color: "#7dd3fc", textDecoration: "underline", opacity: publishDeployment.subdomainUrl ? 0.6 : 1 }}
                            >
                                /p/{publishDeployment.publishId}
                            </a>
                            <button
                                type="button"
                                onClick={handleCopyPublishLink}
                                style={{
                                    background: "transparent",
                                    border: "1px solid rgba(125,211,252,0.30)",
                                    color: "#7dd3fc",
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
                                    border: "1px solid rgba(125,211,252,0.25)",
                                    color: "#7dd3fc",
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
                                        border: "1px solid rgba(125,211,252,0.35)",
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

                {previewTab === "preview" && hasPreviewArtifacts && (
                    <PreviewViewportSelector value={previewViewport} onChange={setPreviewViewport} />
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
                        <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 0, position: "relative" }}>
                        {/* Main preview area with optional viewport width+height constraint */}
                        <div style={{
                            flex: 1,
                            minWidth: 0,
                            minHeight: 0,
                            position: "relative",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            // for constrained viewports scroll vertically
                            overflowY: viewportDimensions(previewViewport) ? "auto" : "hidden",
                            padding: viewportDimensions(previewViewport) ? "16px 0 24px" : 0,
                        }}>
                        {/* Viewport-constrained inner frame */}
                        <div style={{
                            width: viewportDimensions(previewViewport)?.w ?? "100%",
                            height: viewportDimensions(previewViewport)?.h,
                            maxWidth: "100%",
                            flex: viewportDimensions(previewViewport) ? "none" : 1,
                            minHeight: viewportDimensions(previewViewport) ? undefined : 0,
                            position: "relative",
                            display: "flex",
                            flexDirection: "column",
                            transition: "width 0.2s ease, height 0.2s ease",
                            boxShadow: viewportDimensions(previewViewport) ? "0 8px 40px rgba(0,0,0,0.55), 0 0 0 1px var(--border)" : undefined,
                            borderRadius: viewportDimensions(previewViewport) ? "var(--radius)" : undefined,
                            overflow: viewportDimensions(previewViewport) ? "hidden" : undefined,
                        }}>
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
                                        color: "#7dd3fc",
                                        fontSize: "0.82rem",
                                        fontWeight: 600,
                                        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                                    }}
                                >
                                    <span
                                        style={{
                                            width: 14,
                                            height: 14,
                                            border: "2px solid #7dd3fc",
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
                        </div>{/* /viewport-frame */}
                        </div>{/* /main-preview-area */}
                        {/* EDIT media sidebar — reusable MediaGrid */}
                        {editMode && editMediaList.length > 0 && (
                            <MediaGrid
                                items={editMediaList}
                                selectedId={
                                    selectedElement?.selector
                                        ? editMediaList.find((m) => m.meta?.selector === selectedElement.selector)?.id ?? null
                                        : null
                                }
                                onSelect={(item) => {
                                    const selector = item.meta?.selector as string | undefined;
                                    const pfId = item.meta?.stableNodeId as string | undefined;
                                    iframeRef.current?.contentWindow?.postMessage({
                                        type: "pf-edit-scroll-to",
                                        selector: selector || "",
                                        pfId: pfId?.startsWith("pf:") ? pfId.slice(3) : undefined,
                                    }, "*");
                                }}
                                title="🖼 Assets"
                                columns={1}
                                filters={[
                                    { key: "img", label: t("workspace.editMediaFilters.images"), match: (i) => i.mediaType === "image" },
                                    { key: "bg", label: t("workspace.editMediaFilters.backgrounds"), match: (i) => i.mediaType === "background" },
                                ]}
                                headerActions={
                                    <button
                                        type="button"
                                        onClick={() => iframeRef.current?.contentWindow?.postMessage({ type: "pf-edit-scan-media" }, "*")}
                                        className="bg-transparent border-none cursor-pointer text-muted-foreground text-[0.7rem] px-1 hover:text-foreground transition-colors"
                                        title="Rescan immagini dalla preview"
                                    >↻</button>
                                }
                                className="w-[160px] min-w-[160px]"
                            />
                        )}
                        </div>
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
                                        <span style={{ color: "var(--accent, #7dd3fc)", marginLeft: "0.75rem" }}>
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
                                        color: "var(--accent, #7dd3fc)",
                                        border: "1px solid var(--accent, #7dd3fc)",
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
                                            badgeColor="#7dd3fc"
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
            onClose={() => {
                setConfigOpen(false);
                void loadProjectAssets();
            }}
            initialProjectName={projectName}
            onRename={(name: string) => setProjectName(name)}
            presetLabel={presetCatalog.find(p => p.id === projectPresetId)?.labelIt}
            briefGuideQuestions={presetCatalog.find(p => p.id === projectPresetId)?.briefGuideQuestions}
            presetRecommendedModelLabel={presetCatalog.find(p => p.id === projectPresetId)?.recommendedModel?.label ?? presetCatalog.find(p => p.id === projectPresetId)?.recommendedModel?.modelId}
            onAssetPick={(asset) => void handleApplyAsset(asset)}
        />
        <LlmProviderErrorDialog
            open={Boolean(llmErrorDialog)}
            error={llmErrorDialog}
            onOpenChange={(open) => {
                if (!open) setLlmErrorDialog(null);
            }}
        />
        </div>
    );
}

// ─── SnapshotHistoryPanel → see apps/web/components/workspace/SnapshotHistoryPanel.tsx ───

// ─── Inspect infrastructure: PF_INSPECT_SCRIPT, PF_EDIT_SCRIPT → see ./iframe-scripts.ts ───



function getElementTargetType(
    tag: string,
    mediaMode?: SelectedFocusElement["mediaMode"],
): "html" | "css" | "js" | "component" | "section" {
    if (mediaMode === "foreground" || mediaMode === "background") return "component";
    if (["section", "main", "article", "header", "footer", "nav", "aside"].includes(tag)) return "section";
    if (["button", "input", "select", "textarea", "form", "canvas", "svg", "img", "picture", "figure", "video"].includes(tag)) return "component";
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
                            background: isSaving ? undefined : "rgba(125,211,252,0.08)",
                            color: isSaving ? "var(--text-muted)" : "#7dd3fc",
                            borderColor: "#7dd3fc",
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
    const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
    const containerRef = useRef<HTMLDivElement>(null);

    function openTooltip() {
        if (containerRef.current) {
            const r = containerRef.current.getBoundingClientRect();
            setTooltipStyle({
                position: "fixed",
                bottom: `calc(100vh - ${Math.round(r.top)}px + 8px)`,
                left: `${Math.round(r.left)}px`,
            });
        }
        setOpen(true);
    }

    if (!message || !message.metadata) return null;

    const m = message.metadata;
    const usage = m.tokenUsage;
    const cost = m.costEstimate;
    const trace = m.promptingTrace;
    const operation = m.operation;

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
            onMouseEnter={openTooltip}
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
                <div className="req-meta-tooltip" style={tooltipStyle}>
                    <div className="req-meta-tooltip-title">{tooltipTitle}</div>

                    {operation && (
                        <>
                            <div className="req-meta-section">
                                <span className="req-meta-label">Flusso</span>
                                <span className="req-meta-value">{operation.label ?? operation.kind}</span>
                            </div>
                            {operation.target && (
                                <div className="req-meta-section">
                                    <span className="req-meta-label">Target</span>
                                    <span className="req-meta-value">{operation.target}</span>
                                </div>
                            )}
                            <div className="req-meta-divider" />
                        </>
                    )}

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
    const operation = message.metadata?.operation;

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
                {operation && (
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.45rem", flexWrap: "wrap" }}>
                        <span
                            style={{
                                fontSize: "0.66rem",
                                fontWeight: 700,
                                letterSpacing: "0.04em",
                                textTransform: "uppercase",
                                padding: "0.12rem 0.4rem",
                                borderRadius: "999px",
                                background: "rgba(125,211,252,0.12)",
                                color: "#7dd3fc",
                                border: "1px solid rgba(125,211,252,0.25)",
                            }}
                        >
                            ⚙ {operation.label ?? operation.kind}
                        </span>
                        {operation.mode && (
                            <span style={{ fontSize: "0.66rem", color: "var(--text-muted)" }}>
                                {operation.mode}
                            </span>
                        )}
                    </div>
                )}
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
                {operation?.label ? `${message.role} · ${operation.label}` : message.role}
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
