export interface PreviewSnapshotArtifacts {
    html: string;
    css: string;
    js: string;
}

export interface PreviewSnapshotFocusContext {
    mode: "project" | "preview-element" | "code-selection";
    targetType: "html" | "css" | "js" | "component" | "section";
    userIntent?: string;
    selectedElement?: {
        stableNodeId: string;
        selector: string;
        tag: string;
        classes: string[];
        textSnippet?: string;
        currentSrc?: string;
        currentAlt?: string;
        backgroundImageUrl?: string;
        mediaMode?: "foreground" | "background" | "none";
    };
    codeSelection?: {
        language: "html" | "css" | "js";
        startLine: number;
        endLine: number;
        selectedText?: string;
    };
}

export interface PreviewSnapshotMetadata {
    model?: string;
    provider?: string;
    durationMs?: number;
    finishReason?: string;
    structuredParseValid?: boolean;
    rawResponse?: string;
    wysiwygSessionId?: string;
    tokenUsage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    promptingTrace?: {
        originalUserMessage: string;
        prePromptTemplate?: string;
        effectiveSystemPrompt?: string;
    };
    mediaResolution?: {
        version: "media-resolution-v1";
        traceIds: string[];
        assetIds: string[];
        mediaKeys: string[];
        degraded: boolean;
        directives?: Array<{
            key: string;
            role?: string;
            semanticQuery?: string;
            status: "resolved" | "fallback_resolved" | "unresolved";
            provider?: string;
            assetId?: string;
            fallbackUsed?: boolean;
        }>;
    };
}

export interface PreviewSnapshot {
    id: string;
    projectId: string;
    conversationId: string;
    sourceMessageId?: string;
    parentSnapshotId?: string;
    isActive: boolean;
    artifacts: PreviewSnapshotArtifacts;
    focusContext?: PreviewSnapshotFocusContext;
    metadata?: PreviewSnapshotMetadata;
    /**
     * Stored path / key for the background-generated Puppeteer JPEG thumbnail.
     * Absent until the async job completes. Use the thumbnail API endpoint to serve it.
     */
    thumbnailPath?: string;
    createdAt: Date;
    activatedAt?: Date;
}
