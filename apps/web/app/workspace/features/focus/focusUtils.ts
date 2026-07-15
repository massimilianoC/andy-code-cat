import { ApiError, type LlmFocusContext } from "@/lib/api";

export type SelectedFocusElement = NonNullable<LlmFocusContext["selectedElement"]>;

const MAX_FOCUS_SELECTOR_LEN = 240;
const MAX_FOCUS_NODE_ID_LEN = 120;
const MAX_FOCUS_TEXT_LEN = 160;
const MAX_FOCUS_OUTER_HTML_LEN = 8000;
const MAX_FOCUS_CLASSES = 8;
const INVALID_FOCUS_TAGS = new Set(["html", "body", "head", "script", "style", "link", "meta"]);

export function appendPromptSegment(base: string, addition: string): string {
    const normalizedAddition = addition.trim();
    if (!normalizedAddition) return base;
    if (!base.trim()) return normalizedAddition;
    const needsSpace = !/[\s\n]$/.test(base);
    return `${base}${needsSpace ? " " : ""}${normalizedAddition}`;
}

export function sanitizeRuntimeMediaUrl(value?: string): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed || /^data:/i.test(trimmed) || /^asset:\/\/media\//i.test(trimmed)) return undefined;

    const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
    if (scheme && !["http", "https", "blob"].includes(scheme)) return undefined;

    return trimmed.length > 1500 ? trimmed.slice(0, 1500) : trimmed;
}

function clipFocusValue(value: string | undefined, max: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function sanitizeMediaElementPayload(element: SelectedFocusElement) {
    return {
        stableNodeId: element.stableNodeId,
        selector: element.selector,
        tag: element.tag,
        textSnippet: clipFocusValue(element.textSnippet, 500),
        currentSrc: sanitizeRuntimeMediaUrl(element.currentSrc),
        currentAlt: clipFocusValue(element.currentAlt, 300),
        backgroundImageUrl: sanitizeRuntimeMediaUrl(element.backgroundImageUrl),
        mediaMode: element.mediaMode,
        originalWidth: element.originalWidth,
        originalHeight: element.originalHeight,
        aspectRatio: element.aspectRatio,
    };
}

export function inferStockImageQuery(element: SelectedFocusElement, fallbackPrompt: string): string {
    for (const candidate of [element.currentAlt, element.textSnippet, fallbackPrompt]) {
        const cleaned = candidate?.replace(/\s+/g, " ").trim();
        if (cleaned && cleaned.length >= 3) return cleaned.slice(0, 120);
    }

    const src = sanitizeRuntimeMediaUrl(element.currentSrc) || sanitizeRuntimeMediaUrl(element.backgroundImageUrl) || "";
    try {
        const url = new URL(src);
        if (url.hostname.includes("loremflickr.com")) {
            const keyword = url.pathname.split("/").filter(Boolean)[2]?.replace(/[,+_-]+/g, " ");
            if (keyword) return decodeURIComponent(keyword).slice(0, 120);
        }
        if (url.hostname.includes("picsum.photos")) {
            const seed = url.pathname.split("/").filter(Boolean)[1]?.replace(/[,+_-]+/g, " ");
            if (seed) return decodeURIComponent(seed).slice(0, 120);
        }
    } catch {
        // Ignore malformed URLs and use a stable fallback.
    }
    return "website image";
}

export function sanitizeSelectedElementForFocus(
    element: LlmFocusContext["selectedElement"] | null | undefined,
): SelectedFocusElement | null {
    if (!element) return null;

    const tag = clipFocusValue(element.tag?.toLowerCase(), 64);
    if (!tag || INVALID_FOCUS_TAGS.has(tag)) return null;

    const stableNodeId = clipFocusValue(element.stableNodeId, MAX_FOCUS_NODE_ID_LEN);
    const selector = clipFocusValue(element.selector, MAX_FOCUS_SELECTOR_LEN);
    if (!stableNodeId || !selector) return null;

    const classes = Array.isArray(element.classes)
        ? element.classes
            .map((item) => clipFocusValue(item, 60))
            .filter((item): item is string => Boolean(item))
            .slice(0, MAX_FOCUS_CLASSES)
        : [];
    const textSnippet = clipFocusValue(element.textSnippet, MAX_FOCUS_TEXT_LEN);
    const outerHtml = clipFocusValue(element.outerHtml, MAX_FOCUS_OUTER_HTML_LEN);
    const currentSrc = sanitizeRuntimeMediaUrl(clipFocusValue(element.currentSrc, 1500));
    const currentAlt = clipFocusValue(element.currentAlt, 300);
    const backgroundImageUrl = sanitizeRuntimeMediaUrl(clipFocusValue(element.backgroundImageUrl, 1500));
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

    if (outerHtml && /^<(html|body)\b/i.test(outerHtml)) return null;

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

export function extractMediaKeyFromSelectedElement(
    element: LlmFocusContext["selectedElement"] | null | undefined,
): string | null {
    const match = (element?.outerHtml ?? "").match(/\bdata-media-key=["']([a-z0-9]+(?:-[a-z0-9]+)*)["']/i);
    return match?.[1] ?? null;
}

export function isFocusContextValidationError(error: unknown): boolean {
    if (!(error instanceof ApiError) || error.status !== 400) return false;
    const details = error.details as { fieldErrors?: { focusContext?: unknown } } | undefined;
    return Array.isArray(details?.fieldErrors?.focusContext) && details.fieldErrors.focusContext.length > 0;
}

export function getElementTargetType(
    tag: string,
    mediaMode?: SelectedFocusElement["mediaMode"],
): "html" | "css" | "js" | "component" | "section" {
    if (mediaMode === "foreground" || mediaMode === "background") return "component";
    if (["section", "main", "article", "header", "footer", "nav", "aside"].includes(tag)) return "section";
    if (["button", "input", "select", "textarea", "form", "canvas", "svg", "img", "picture", "figure", "video"].includes(tag)) return "component";
    return "html";
}
