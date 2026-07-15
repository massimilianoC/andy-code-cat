import type { MessageDto } from "@/lib/api";

type MessageMetadataView = NonNullable<MessageDto["metadata"]>;
export type MessageMediaResolutionView = NonNullable<MessageMetadataView["mediaResolution"]>;

export function formatCostEur(amount: number | undefined): string {
    if (!amount || amount <= 0) return "";
    if (amount < 0.0001) return "<€0.0001";
    if (amount < 0.01) return `€${amount.toFixed(4)}`;
    if (amount < 1) return `€${amount.toFixed(3)}`;
    return `€${amount.toFixed(2)}`;
}

export function clipIdentifier(value: string | undefined, head = 8, tail = 4): string {
    if (!value) return "—";
    if (value.length <= head + tail + 1) return value;
    return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function getMediaResolvedCount(mediaResolution: MessageMediaResolutionView | undefined): number {
    if (!mediaResolution) return 0;
    return mediaResolution.directives?.filter((directive) =>
        directive.status === "resolved" || directive.status === "fallback_resolved",
    ).length ?? mediaResolution.assetIds?.length ?? 0;
}

export function getMediaFailedCount(mediaResolution: MessageMediaResolutionView | undefined): number {
    if (!mediaResolution) return 0;
    return mediaResolution.directives?.filter((directive) => directive.status === "unresolved").length
        ?? Math.max(0, (mediaResolution.mediaKeys?.length ?? 0) - getMediaResolvedCount(mediaResolution));
}

export function getMessageOutcomeSummary(message: MessageDto | undefined) {
    const metadata = message?.metadata;
    const mediaResolution = metadata?.mediaResolution;
    return {
        hasSnapshot: Boolean(metadata?.snapshotId),
        hasMedia: Boolean(mediaResolution?.mediaKeys?.length),
        resolvedCount: getMediaResolvedCount(mediaResolution),
        failedCount: getMediaFailedCount(mediaResolution),
        degraded: Boolean(mediaResolution?.degraded),
    };
}

export function parseChatFromContent(content: string): { summary: string; bullets: string[]; nextActions: string[] } | null {
    if (!content?.startsWith("```json")) return null;
    try {
        let jsonText = content.replace(/^```(?:json)?\s*\n?/i, "");
        const lastFence = jsonText.lastIndexOf("```");
        if (lastFence > 0) jsonText = jsonText.slice(0, lastFence).trim();
        const parsed = JSON.parse(jsonText) as { chat?: { summary?: string; bullets?: unknown; nextActions?: unknown } };
        if (parsed?.chat?.summary) {
            return {
                summary: String(parsed.chat.summary),
                bullets: Array.isArray(parsed.chat.bullets) ? parsed.chat.bullets.map(String) : [],
                nextActions: Array.isArray(parsed.chat.nextActions) ? parsed.chat.nextActions.map(String) : [],
            };
        }
    } catch {
        // Non-structured assistant content is rendered as plain text.
    }
    return null;
}

export function estimateTokens(text: string | undefined): number {
    if (!text) return 0;
    return Math.max(1, Math.round(text.length / 4));
}

export function formatDuration(ms: number | undefined): string {
    if (!ms) return "—";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}
