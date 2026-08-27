import { call } from "./call";
import type {
    CanonicalBriefEnvelope,
    GenerationWorkspaceDto,
    LaunchWorkspacePipelineInput,
    LaunchWorkspacePipelineResultDto,
    PipelineRunDto,
    PreviewCanonicalBriefInput,
} from "@andy-code-cat/contracts";

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
    /** Filenames of documents attached during intake, included in the server-built canonical brief. */
    attachmentNames?: string[];
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

/**
 * Side-effect-free canonical brief, for the wizard's review step. Creates nothing: the launch
 * below is the only call that writes.
 */
export function previewCanonicalBrief(
    token: string,
    projectId: string,
    input: PreviewCanonicalBriefInput,
) {
    return call<{ brief: CanonicalBriefEnvelope }>(
        "POST",
        `/v1/projects/${projectId}/pipeline/brief-preview`,
        input,
        {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        },
    );
}

/**
 * I15 of the SSOT program — server-owned Workspace launch (see `LaunchWorkspacePipeline` on the
 * API side). Behind `PIPELINE_RUN_ENABLED` on the backend; 404s if that flag is off. This is the
 * only guided-launch entry point. The legacy client function and the three routes behind it
 * (/pipelines/guided and its aliases) were removed on 2026-08-27: they launched without creating
 * a PipelineRun, so the same user action could run certified or uncertified depending on the URL.
 */
export function launchWorkspacePipeline(
    token: string,
    projectId: string,
    input: LaunchWorkspacePipelineInput,
) {
    return call<LaunchWorkspacePipelineResultDto>(
        "POST",
        `/v1/projects/${projectId}/pipeline/launch-workspace`,
        input,
        {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        },
    );
}

/** I15 — reads back the PipelineRun a `launchWorkspacePipeline()` call created (I7's route). */
export function getPipelineRun(token: string, projectId: string, runId: string) {
    return call<{ run: PipelineRunDto }>(
        "GET",
        `/v1/projects/${projectId}/pipeline-runs/${runId}`,
        undefined,
        {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        },
    );
}
