import { call } from "./call";
import type { GenerationWorkspaceDto, ZeroEffortLaunchResultDto } from "@andy-code-cat/contracts";

export type ZeroEffortSiteType = "landing_page" | "portfolio" | "showcase" | "business_site";

export interface ZeroEffortLaunchInput {
    businessName: string;
    siteType: ZeroEffortSiteType;
    primaryGoal: string;
    audience: string;
    tone?: string;
    primaryCta?: string;
    styleHint?: string;
    contactInfo?: Array<{ key: string; value: string }>;
    styleAttributes?: string[];
}

export interface ProjectPipelineRunSummary {
    mode: "zero-effort";
    status: "prepared";
    projectId: string;
    conversationId: string;
    jobId: string;
    normalizedBrief: string;
    suggestedNextActions: string[];
    workspace: GenerationWorkspaceDto;
}

export interface ZeroEffortTaskConfig {
    enabled: boolean;
    provider: string;
    model: string;
    temperature: number;
    maxCompletionTokens: number;
    systemTemplate: string;
}

export interface ZeroEffortPipelineConfig {
    optimize: ZeroEffortTaskConfig;
    generate: ZeroEffortTaskConfig;
}

export function launchZeroEffort(
    token: string,
    projectId: string,
    input: ZeroEffortLaunchInput,
) {
    return call<ZeroEffortLaunchResultDto>(
        "POST",
        `/v1/projects/${projectId}/pipelines/zero-effort`,
        input,
        {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        },
    );
}

export function getZeroEffortConfig(token: string, projectId: string) {
    return call<ZeroEffortPipelineConfig>(
        "GET",
        `/v1/projects/${projectId}/pipelines/zero-effort/config`,
        undefined,
        {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        },
    );
}
