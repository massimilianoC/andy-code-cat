import { call } from "./call";
import type { GenerationWorkspaceDto, GuidedLaunchResultDto } from "@andy-code-cat/contracts";

export interface GuidedLaunchInput {
    businessName: string;
    /** PRESET_CATALOG id (e.g. "slideshow", "landing", "website", "videogame"). */
    presetId: string;
    primaryGoal: string;
    audience: string;
    tone?: string;
    primaryCta?: string;
    styleHint?: string;
    sourceRequest?: string;
    projectSummary?: string;
    contentStructure?: string;
    contentRequirements?: string;
    functionalRequirements?: string;
    interactionModel?: string;
    visualDirection?: string;
    successCriteria?: string;
    constraints?: string;
    mustAvoid?: string;
    contactInfo?: Array<{ key: string; value: string }>;
    styleAttributes?: string[];
    /** BCP-47 output language directive (e.g. "it", "en", "fr"). */
    outputLanguage?: string;
}

export interface ProjectPipelineRunSummary {
    mode: "guided";
    status: "prepared";
    projectId: string;
    conversationId: string;
    jobId: string;
    normalizedBrief: string;
    suggestedNextActions: string[];
    workspace: GenerationWorkspaceDto;
}

export interface GuidedTaskConfig {
    enabled: boolean;
    provider: string;
    model: string;
    temperature: number;
    maxCompletionTokens: number;
    systemTemplate: string;
}

export interface GuidedPipelineConfig {
    optimize: GuidedTaskConfig;
    generate: GuidedTaskConfig;
    vibeGenerate: GuidedTaskConfig;
    /**
     * The API dual-emits this alongside the legacy `godModeGenerate` field for one release
     * (see apps/api/src/presentation/http/routes/pipelineRoutes.ts) — prefer this field.
     */
    projectModeGenerate: GuidedTaskConfig;
    /** @deprecated use projectModeGenerate — kept for one release for cached-bundle safety. */
    godModeGenerate?: GuidedTaskConfig;
    attachmentPolicy?: {
        maxAttachmentsPerPrompt: number;
        maxFileSizeBytes: number;
        maxTotalBytes: number;
        warningThresholdBytes: number;
    };
    documentContextPolicy?: {
        maxAssetsPerPrompt: number;
        fallbackInlineExtractionMaxAssets: number;
    };
}

export function launchGuided(
    token: string,
    projectId: string,
    input: GuidedLaunchInput,
) {
    return call<GuidedLaunchResultDto>(
        "POST",
        `/v1/projects/${projectId}/pipelines/guided`,
        input,
        {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        },
    );
}

export function getGuidedPipelineConfig(token: string, projectId: string) {
    return call<GuidedPipelineConfig>(
        "GET",
        `/v1/projects/${projectId}/pipelines/guided/config`,
        undefined,
        {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        },
    );
}
