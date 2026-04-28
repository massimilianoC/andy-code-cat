import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";

export interface AiUsageRecentRequest {
    id: string;
    kind: "llm" | "image";
    status: string;
    provider: string;
    model?: string;
    createdAt: string;
    costEur: number;
    totalTokens?: number;
    promptPreview: string;
    imageSize?: string;
}

export interface AiUsageAnalyticsResult {
    totals: {
        totalCost: number;
        llmCost: number;
        imageCost: number;
        totalTokens: number;
        llmRuns: number;
        imageRuns: number;
        queuedImages: number;
        failedImages: number;
    };
    topModels: Array<{
        kind: "llm" | "image";
        provider: string;
        model: string;
        runs: number;
        totalCost: number;
        totalTokens?: number;
    }>;
    recentRequests: AiUsageRecentRequest[];
}

function clipPrompt(value: string | undefined, max = 140): string {
    const trimmed = value?.trim() ?? "";
    if (!trimmed) return "";
    return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export class GetProjectAiAnalytics {
    constructor(
        private readonly promptExecutionLogRepository: PromptExecutionLogRepository,
        private readonly projectAssetRepository: ProjectAssetRepository,
    ) { }

    async execute(projectId: string, userId: string): Promise<AiUsageAnalyticsResult> {
        const [llmSummary, llmRecent, imageSummary, imageRecent] = await Promise.all([
            this.promptExecutionLogRepository.summarizeByProject(projectId, userId),
            this.promptExecutionLogRepository.listRecentByProject(projectId, userId, 8),
            this.projectAssetRepository.summarizeGenerationByProject(projectId, userId),
            this.projectAssetRepository.listRecentGeneratedByProject(projectId, userId, 8),
        ]);

        const recentRequests: AiUsageRecentRequest[] = [
            ...llmRecent.map((entry) => ({
                id: entry.id,
                kind: "llm" as const,
                status: entry.status,
                provider: entry.provider,
                model: entry.model,
                createdAt: entry.createdAt.toISOString(),
                costEur: entry.costEstimate?.amount ?? 0,
                totalTokens: entry.usage?.totalTokens,
                promptPreview: clipPrompt(entry.inputPrompt),
            })),
            ...imageRecent.map((entry) => ({
                id: entry.id,
                kind: "image" as const,
                status: entry.generationStatus ?? "ready",
                provider: entry.generationMetadata?.provider ?? "system",
                model: entry.generationMetadata?.model,
                createdAt: entry.createdAt.toISOString(),
                costEur: entry.generationMetadata?.cost?.amount ?? 0,
                totalTokens: entry.generationMetadata?.tokenUsage?.totalTokens,
                promptPreview: clipPrompt(entry.generationPrompt ?? entry.label ?? entry.originalName),
                imageSize: entry.generationMetadata?.imageSize,
            })),
        ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 12);

        return {
            totals: {
                totalCost: Number((llmSummary.totalCost + imageSummary.totalCost).toFixed(6)),
                llmCost: llmSummary.totalCost,
                imageCost: imageSummary.totalCost,
                totalTokens: llmSummary.totalTokens,
                llmRuns: llmSummary.runs,
                imageRuns: imageSummary.totalImages,
                queuedImages: imageSummary.queued,
                failedImages: imageSummary.failed,
            },
            topModels: [
                ...(llmSummary.topModels ?? []).map((entry) => ({
                    kind: "llm" as const,
                    provider: entry.provider,
                    model: entry.model,
                    runs: entry.runs,
                    totalCost: entry.totalCost,
                    totalTokens: entry.totalTokens,
                })),
                ...(imageSummary.topModels ?? []).map((entry) => ({
                    kind: "image" as const,
                    provider: entry.provider,
                    model: entry.model,
                    runs: entry.runs,
                    totalCost: entry.totalCost,
                    totalTokens: undefined,
                })),
            ]
                .sort((a, b) => b.totalCost - a.totalCost || b.runs - a.runs)
                .slice(0, 8),
            recentRequests,
        };
    }
}

export class GetAdminAiAnalytics {
    constructor(
        private readonly promptExecutionLogRepository: PromptExecutionLogRepository,
        private readonly projectAssetRepository: ProjectAssetRepository,
    ) { }

    async execute(): Promise<AiUsageAnalyticsResult> {
        const [llmSummary, llmRecent, imageSummary, imageRecent] = await Promise.all([
            this.promptExecutionLogRepository.summarizeAll(),
            this.promptExecutionLogRepository.listRecentAll(10),
            this.projectAssetRepository.summarizeGenerationAll(),
            this.projectAssetRepository.listRecentGeneratedAll(10),
        ]);

        const recentRequests: AiUsageRecentRequest[] = [
            ...llmRecent.map((entry) => ({
                id: entry.id,
                kind: "llm" as const,
                status: entry.status,
                provider: entry.provider,
                model: entry.model,
                createdAt: entry.createdAt.toISOString(),
                costEur: entry.costEstimate?.amount ?? 0,
                totalTokens: entry.usage?.totalTokens,
                promptPreview: clipPrompt(entry.inputPrompt),
            })),
            ...imageRecent.map((entry) => ({
                id: entry.id,
                kind: "image" as const,
                status: entry.generationStatus ?? "ready",
                provider: entry.generationMetadata?.provider ?? "system",
                model: entry.generationMetadata?.model,
                createdAt: entry.createdAt.toISOString(),
                costEur: entry.generationMetadata?.cost?.amount ?? 0,
                totalTokens: entry.generationMetadata?.tokenUsage?.totalTokens,
                promptPreview: clipPrompt(entry.generationPrompt ?? entry.label ?? entry.originalName),
                imageSize: entry.generationMetadata?.imageSize,
            })),
        ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 15);

        return {
            totals: {
                totalCost: Number((llmSummary.totalCost + imageSummary.totalCost).toFixed(6)),
                llmCost: llmSummary.totalCost,
                imageCost: imageSummary.totalCost,
                totalTokens: llmSummary.totalTokens,
                llmRuns: llmSummary.runs,
                imageRuns: imageSummary.totalImages,
                queuedImages: imageSummary.queued,
                failedImages: imageSummary.failed,
            },
            topModels: [
                ...(llmSummary.topModels ?? []).map((entry) => ({
                    kind: "llm" as const,
                    provider: entry.provider,
                    model: entry.model,
                    runs: entry.runs,
                    totalCost: entry.totalCost,
                    totalTokens: entry.totalTokens,
                })),
                ...(imageSummary.topModels ?? []).map((entry) => ({
                    kind: "image" as const,
                    provider: entry.provider,
                    model: entry.model,
                    runs: entry.runs,
                    totalCost: entry.totalCost,
                    totalTokens: undefined,
                })),
            ]
                .sort((a, b) => b.totalCost - a.totalCost || b.runs - a.runs)
                .slice(0, 10),
            recentRequests,
        };
    }
}
