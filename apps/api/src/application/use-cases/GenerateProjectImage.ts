import { randomUUID } from "crypto";
import type { LlmFocusContext } from "@andy-code-cat/contracts";
import type { AssetGenerationMetadata, ProjectAsset } from "../../domain/entities/ProjectAsset";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { IFileStorage } from "../../infra/storage/IFileStorage";
import { env } from "../../config";
import { estimateCost } from "../llm/costPolicy";
import { generateImageWithSiliconFlow } from "../media/generateImageWithSiliconFlow";
import {
    buildAssetSemanticMetadata,
    buildDeferredSvgPlaceholder,
    guessStyleRole,
    safeAssetLabelFromText,
} from "../media/projectAssetSemantics";
import { ExecutionLogger } from "../services/ExecutionLogger";
import { SavePlatformAsset } from "./SavePlatformAsset";

export class GenerateProjectImage {
    constructor(
        private readonly assetRepository: ProjectAssetRepository,
        private readonly storage: IFileStorage,
    ) { }

    async execute(input: {
        projectId: string;
        userId: string;
        prompt: string;
        fileNameHint?: string;
        scope?: "project" | "user";
        provider?: "siliconflow" | "system";
        model?: string;
        imageSize?: string;
        numInferenceSteps?: number;
        targetMode: "foreground" | "background";
        selectedElement?: LlmFocusContext["selectedElement"];
        mediaConfig?: {
            fit?: "cover" | "contain" | "auto";
            repeat?: "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
            opacity?: number;
            filter?: string;
        };
    }): Promise<{
        taskId: string;
        status: "queued";
        mode: "placeholder";
        asset: ProjectAsset;
        storagePath: string;
        cssDefaults: {
            fit: "cover" | "contain" | "auto";
            repeat: "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
            position: "center center";
            opacity: number;
            filter: string;
        };
    }> {
        const taskId = randomUUID();
        const requestedAt = new Date();
        const provider = input.provider ?? (env.hasSiliconFlowApiKey ? "siliconflow" : "system");
        const model = input.model?.trim() || (provider === "siliconflow" ? env.SILICONFLOW_IMAGE_MODEL : "local-placeholder-svg");
        const imageSize = input.imageSize?.trim() || env.SILICONFLOW_IMAGE_SIZE;
        const numInferenceSteps = input.numInferenceSteps ?? env.SILICONFLOW_IMAGE_STEPS;
        const label = safeAssetLabelFromText(input.fileNameHint || input.prompt, "generated-image");
        const semanticMetadata = buildAssetSemanticMetadata({
            promptOrName: input.prompt,
            mimeType: "image/svg+xml",
            mediaKind: input.targetMode === "background" ? "background" : "image",
            classifierProvider: provider,
            classifierModel: provider === "siliconflow" ? model : "heuristic-media-classifier-v1",
        });

        const placeholder = buildDeferredSvgPlaceholder({
            title: label,
            prompt: input.prompt,
            mode: input.targetMode,
            phase: "queued",
        });

        const saver = new SavePlatformAsset(this.assetRepository, this.storage);
        const created = await saver.execute({
            projectId: input.projectId,
            userId: input.userId,
            originalName: `${label}.svg`,
            mimeType: "image/svg+xml",
            buffer: placeholder,
            label,
            scope: input.scope ?? "project",
        });

        const queuedMetadata: AssetGenerationMetadata = {
            provider,
            model,
            imageSize,
            numInferenceSteps,
            requestedAt,
            finishReason: "queued",
        };

        const asset = (await this.assetRepository.update(created.id, input.projectId, input.userId, {
            label,
            useInProject: true,
            styleRole: guessStyleRole(semanticMetadata.mediaKind),
            descriptionText: `Prompt: ${input.prompt}`.slice(0, 500),
            generationStatus: "queued",
            generationPrompt: input.prompt,
            generationMetadata: queuedMetadata,
            semanticMetadata,
        })) ?? created;

        setTimeout(() => {
            void (async () => {
                try {
                    let finalBuffer = buildDeferredSvgPlaceholder({
                        title: label,
                        prompt: input.prompt,
                        mode: input.targetMode,
                        phase: "ready",
                    });
                    let finalMimeType = "image/svg+xml";
                    let finalMetadata: AssetGenerationMetadata;

                    if (provider === "siliconflow" && env.hasSiliconFlowApiKey) {
                        const liveResult = await generateImageWithSiliconFlow({
                            prompt: input.prompt,
                            model,
                            imageSize,
                            numInferenceSteps,
                        });
                        finalBuffer = liveResult.buffer;
                        finalMimeType = liveResult.outputMimeType;

                        const cost = estimateCost(
                            {
                                capability: "image_generation",
                                imageCount: 1,
                                tokenUsage: liveResult.tokenUsage ? {
                                    promptTokens: liveResult.tokenUsage.promptTokens ?? 0,
                                    completionTokens: liveResult.tokenUsage.completionTokens ?? 0,
                                    totalTokens: liveResult.tokenUsage.totalTokens ?? 0,
                                } : undefined,
                                providerCostUsd: liveResult.providerCostUsd,
                            },
                            {
                                textEurPer1kTokens: env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS,
                                imageEurPerAsset: env.COST_POLICY_IMAGE_EUR_PER_ASSET,
                                videoEurPerAsset: env.COST_POLICY_VIDEO_EUR_PER_ASSET,
                                usdToEurRate: env.COST_POLICY_USD_TO_EUR_RATE,
                                providerMarkupFactor: env.COST_POLICY_PROVIDER_MARKUP_FACTOR,
                            }
                        );

                        finalMetadata = {
                            provider: liveResult.provider,
                            model: liveResult.model,
                            imageSize: liveResult.imageSize,
                            numInferenceSteps: liveResult.numInferenceSteps,
                            requestedAt: liveResult.requestedAt,
                            completedAt: liveResult.completedAt,
                            latencyMs: liveResult.latencyMs,
                            revisedPrompt: liveResult.revisedPrompt,
                            finishReason: liveResult.finishReason,
                            providerRequestId: liveResult.providerRequestId,
                            sourceUrl: liveResult.sourceUrl,
                            outputMimeType: liveResult.outputMimeType,
                            width: liveResult.width,
                            height: liveResult.height,
                            tokenUsage: liveResult.tokenUsage,
                            cost: {
                                currency: cost.currency,
                                amount: cost.amount,
                                source: cost.source,
                                providerCostUsd: cost.providerCostUsd,
                            },
                            providerResponse: liveResult.providerResponse,
                        };
                    } else {
                        const completedAt = new Date();
                        const cost = estimateCost(
                            { capability: "image_generation", imageCount: 1 },
                            {
                                textEurPer1kTokens: env.COST_POLICY_TEXT_EUR_PER_1K_TOKENS,
                                imageEurPerAsset: env.COST_POLICY_IMAGE_EUR_PER_ASSET,
                                videoEurPerAsset: env.COST_POLICY_VIDEO_EUR_PER_ASSET,
                                usdToEurRate: env.COST_POLICY_USD_TO_EUR_RATE,
                                providerMarkupFactor: env.COST_POLICY_PROVIDER_MARKUP_FACTOR,
                            }
                        );

                        finalMetadata = {
                            provider: "system",
                            model: "local-placeholder-svg",
                            imageSize,
                            numInferenceSteps,
                            requestedAt,
                            completedAt,
                            latencyMs: completedAt.getTime() - requestedAt.getTime(),
                            finishReason: "placeholder-ready",
                            outputMimeType: finalMimeType,
                            width: 1280,
                            height: 720,
                            cost: {
                                currency: cost.currency,
                                amount: cost.amount,
                                source: cost.source,
                                providerCostUsd: cost.providerCostUsd,
                            },
                            providerResponse: {
                                mode: "fallback",
                                reason: env.hasSiliconFlowApiKey ? "system-provider-requested" : "missing-siliconflow-key",
                            },
                        };
                    }

                    await this.storage.saveUpload(input.userId, input.projectId, created.storedFilename, finalBuffer);
                    await this.assetRepository.update(created.id, input.projectId, input.userId, {
                        mimeType: finalMimeType,
                        fileSize: finalBuffer.byteLength,
                        generationStatus: "ready",
                        generationMetadata: finalMetadata,
                        semanticMetadata: {
                            ...semanticMetadata,
                            summary: `${semanticMetadata.summary} · ${finalMetadata.provider} · selector ${input.selectedElement?.selector ?? "n/a"}`.slice(0, 180),
                            classifiedAt: new Date(),
                        },
                    });

                    ExecutionLogger.instance.emit({
                        projectId: input.projectId,
                        domain: "system",
                        eventType: "image_generation_completed",
                        level: "info",
                        status: "success",
                        durationMs: finalMetadata.latencyMs ?? 0,
                        metadata: {
                            assetId: created.id,
                            provider: finalMetadata.provider,
                            model: finalMetadata.model,
                            imageSize: finalMetadata.imageSize,
                            cost: finalMetadata.cost,
                            tokenUsage: finalMetadata.tokenUsage,
                            targetMode: input.targetMode,
                        },
                    });
                } catch (error) {
                    const completedAt = new Date();
                    const message = error instanceof Error ? error.message : "Image generation failed";
                    const failedPlaceholder = buildDeferredSvgPlaceholder({
                        title: label,
                        prompt: input.prompt,
                        mode: input.targetMode,
                        phase: "failed",
                    });

                    await this.storage.saveUpload(input.userId, input.projectId, created.storedFilename, failedPlaceholder).catch(() => { });
                    await this.assetRepository.update(created.id, input.projectId, input.userId, {
                        mimeType: "image/svg+xml",
                        fileSize: failedPlaceholder.byteLength,
                        generationStatus: "failed",
                        generationMetadata: {
                            provider,
                            model,
                            imageSize,
                            numInferenceSteps,
                            requestedAt,
                            completedAt,
                            latencyMs: completedAt.getTime() - requestedAt.getTime(),
                            finishReason: "failed",
                            errorMessage: message,
                        },
                    }).catch(() => { });

                    ExecutionLogger.instance.emit({
                        projectId: input.projectId,
                        domain: "system",
                        eventType: "image_generation_failed",
                        level: "error",
                        status: "failure",
                        durationMs: completedAt.getTime() - requestedAt.getTime(),
                        metadata: {
                            assetId: created.id,
                            provider,
                            model,
                            error: message,
                            targetMode: input.targetMode,
                        },
                    });
                }
            })().catch(() => { });
        }, 50);

        return {
            taskId,
            status: "queued",
            mode: "placeholder",
            asset,
            storagePath: this.storage.uploadFilePath(input.userId, input.projectId, created.storedFilename),
            cssDefaults: {
                fit: input.mediaConfig?.fit ?? "cover",
                repeat: input.mediaConfig?.repeat ?? "no-repeat",
                position: "center center",
                opacity: typeof input.mediaConfig?.opacity === "number" ? input.mediaConfig.opacity : 1,
                filter: input.mediaConfig?.filter ?? "none",
            },
        };
    }
}
