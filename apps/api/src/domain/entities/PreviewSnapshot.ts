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
    createdAt: Date;
    activatedAt?: Date;
}
