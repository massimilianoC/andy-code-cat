import { z } from "zod";
import { llmFocusContextSchema } from "./llm";
import { mediaResolutionMetadataSchema } from "./mediaResolution";
import { dataDashboardArtifactMetadataSchema } from "./datasetBindings";

export const previewArtifactsSchema = z.object({
    html: z.string().max(10000000),
    css: z.string().max(500000),
    js: z.string().max(500000),
});

export const previewSnapshotMetadataSchema = z.object({
    model: z.string().max(200).optional(),
    provider: z.string().max(120).optional(),
    durationMs: z.number().int().nonnegative().optional(),
    finishReason: z.string().max(120).optional(),
    structuredParseValid: z.boolean().optional(),
    rawResponse: z.string().max(300000).optional(),
    wysiwygSessionId: z.string().max(100).optional(),
    tokenUsage: z.object({
        promptTokens: z.number().int().nonnegative(),
        completionTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
    }).optional(),
    promptingTrace: z.object({
        originalUserMessage: z.string().max(50000),
        prePromptTemplate: z.string().max(50000).optional(),
        effectiveSystemPrompt: z.string().max(50000).optional(),
    }).optional(),
    mediaResolution: mediaResolutionMetadataSchema.optional(),
    dataDashboard: dataDashboardArtifactMetadataSchema.optional(),
}).optional();

export const createPreviewSnapshotSchema = z.object({
    conversationId: z.string().min(1),
    sourceMessageId: z.string().min(1).optional(),
    parentSnapshotId: z.string().min(1).optional(),
    artifacts: previewArtifactsSchema,
    rawLlmResponse: z.string().max(500000).optional(),
    focusContext: llmFocusContextSchema.optional(),
    metadata: previewSnapshotMetadataSchema,
    activate: z.boolean().default(true),
});

export const activatePreviewSnapshotSchema = z.object({
    conversationId: z.string().min(1).optional(),
});

export type CreatePreviewSnapshotInput = z.infer<typeof createPreviewSnapshotSchema>;
export type ActivatePreviewSnapshotInput = z.infer<typeof activatePreviewSnapshotSchema>;

export interface PreviewSnapshotDto {
    id: string;
    projectId: string;
    conversationId: string;
    sourceMessageId?: string;
    parentSnapshotId?: string;
    isActive: boolean;
    artifacts: {
        html: string;
        css: string;
        js: string;
    };
    focusContext?: {
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
    };
    metadata?: {
        model?: string;
        provider?: string;
        durationMs?: number;
        finishReason?: string;
        structuredParseValid?: boolean;
        rawResponse?: string;
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
        dataDashboard?: import("./datasetBindings").DataDashboardArtifactMetadataDto;
    };
    createdAt: string;
    activatedAt?: string;
}
