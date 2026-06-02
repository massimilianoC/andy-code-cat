import type { PlatformConfigRepository } from "../../../domain/repositories/PlatformConfigRepository";
import { DEFAULT_USER_LIMITS } from "../../../domain/entities/User";
import { resolveMediaProviderPolicy } from "../../media/mediaProviderPolicy";
import {
    DEFAULT_PRODUCT_ATTACHMENT_POLICY,
    DEFAULT_PRODUCT_DOCUMENT_CONTEXT_POLICY,
} from "../../../domain/entities/PlatformConfig";

export class GetPlatformConfig {
    constructor(private readonly configRepository: PlatformConfigRepository) { }

    async execute() {
        const config = await this.configRepository.get();
        // Return current state or defaults if singleton not yet created
        const effective = config ?? {
            id: "global",
            registrationOpen: true,
            emailVerificationRequired: false,
            defaultUserLimits: { ...DEFAULT_USER_LIMITS },
            governanceByProduct: {},
            updatedAt: new Date(),
        };

        const governanceByProduct = Object.fromEntries(
            Object.entries(effective.governanceByProduct ?? {}).map(([productKey, governance]) => [
                productKey,
                {
                    promptTemplates: {
                        generationSystem: governance.promptTemplates.generationSystem ?? "",
                        focusedEditSystem: governance.promptTemplates.focusedEditSystem ?? "",
                        reviewSystem: governance.promptTemplates.reviewSystem ?? "",
                    },
                    promptTaskSettings: Object.fromEntries(
                        Object.entries(governance.promptTaskSettings ?? {}).map(([taskKey, task]) => [
                            taskKey,
                            {
                                enabled: task.enabled ?? true,
                                provider: task.provider ?? "siliconflow",
                                model: task.model ?? "MiniMaxAI/MiniMax-M2.5",
                                temperature: task.temperature ?? 0.7,
                                maxCompletionTokens: task.maxCompletionTokens ?? 1200,
                                systemTemplate: task.systemTemplate ?? "",
                            },
                        ]),
                    ),
                    injections: {
                        headHtml: governance.injections.headHtml ?? "",
                        headerHtml: governance.injections.headerHtml ?? "",
                        footerHtml: governance.injections.footerHtml ?? "",
                        scriptInHead: governance.injections.scriptInHead ?? "",
                        scriptBeforeBodyClose: governance.injections.scriptBeforeBodyClose ?? "",
                        globalCss: governance.injections.globalCss ?? "",
                        googleTagManagerId: governance.injections.googleTagManagerId ?? "",
                        googleAnalyticsId: governance.injections.googleAnalyticsId ?? "",
                        matomoSiteId: governance.injections.matomoSiteId ?? "",
                        matomoUrl: governance.injections.matomoUrl ?? "",
                    },
                    cookieBanner: {
                        enabled: governance.cookieBanner?.enabled ?? false,
                        position: governance.cookieBanner?.position ?? "bottom",
                        texts: governance.cookieBanner?.texts ?? {},
                    },
                    legal: {
                        privacyPolicyUrls: governance.legal?.privacyPolicyUrls ?? {},
                        cookiePolicyUrls: governance.legal?.cookiePolicyUrls ?? {},
                        privacyPolicyHtml: governance.legal?.privacyPolicyHtml ?? {},
                        cookiePolicyHtml: governance.legal?.cookiePolicyHtml ?? {},
                    },
                    nginx: {
                        publicDomain: governance.nginx.publicDomain ?? "",
                        publishSubdomainPattern: governance.nginx.publishSubdomainPattern ?? "{publishId}",
                        cacheTtlSeconds: governance.nginx.cacheTtlSeconds ?? 300,
                        clientMaxBodySizeMb: governance.nginx.clientMaxBodySizeMb ?? 20,
                        extraServerDirectives: governance.nginx.extraServerDirectives ?? "",
                    },
                    attachmentPolicy: {
                        maxAttachmentsPerPrompt:
                            governance.attachmentPolicy?.maxAttachmentsPerPrompt
                            ?? DEFAULT_PRODUCT_ATTACHMENT_POLICY.maxAttachmentsPerPrompt,
                        maxFileSizeBytes:
                            governance.attachmentPolicy?.maxFileSizeBytes
                            ?? DEFAULT_PRODUCT_ATTACHMENT_POLICY.maxFileSizeBytes,
                        maxTotalBytes:
                            governance.attachmentPolicy?.maxTotalBytes
                            ?? DEFAULT_PRODUCT_ATTACHMENT_POLICY.maxTotalBytes,
                        warningThresholdBytes:
                            governance.attachmentPolicy?.warningThresholdBytes
                            ?? DEFAULT_PRODUCT_ATTACHMENT_POLICY.warningThresholdBytes,
                    },
                    documentContextPolicy: {
                        maxAssetsPerPrompt:
                            governance.documentContextPolicy?.maxAssetsPerPrompt
                            ?? DEFAULT_PRODUCT_DOCUMENT_CONTEXT_POLICY.maxAssetsPerPrompt,
                        fallbackInlineExtractionMaxAssets:
                            governance.documentContextPolicy?.fallbackInlineExtractionMaxAssets
                            ?? DEFAULT_PRODUCT_DOCUMENT_CONTEXT_POLICY.fallbackInlineExtractionMaxAssets,
                    },
                },
            ])
        );

        return {
            registrationOpen: effective.registrationOpen,
            emailVerificationRequired: effective.emailVerificationRequired,
            defaultUserLimits: {
                ...effective.defaultUserLimits,
                planExpiresAt: effective.defaultUserLimits.planExpiresAt?.toISOString(),
            },
            governanceByProduct,
            mediaProviderPolicy: resolveMediaProviderPolicy(effective),
            updatedAt: effective.updatedAt.toISOString(),
            updatedByUserId: effective.updatedByUserId,
        };
    }
}
