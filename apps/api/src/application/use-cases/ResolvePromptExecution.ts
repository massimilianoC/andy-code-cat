import type { LlmFocusContext } from "@andy-code-cat/contracts";
import { MODEL_NOT_AVAILABLE } from "@andy-code-cat/contracts";
import { HttpError } from "../../presentation/http/errors/httpError";
import { PRESET_MAP, withStaticViewportFallback } from "../../domain/entities/ProjectPreset";
import {
    resolveAttachmentPolicyFromConfig,
    resolveDocumentContextPolicyFromConfig,
    resolveGovernanceSystemPromptFromConfig,
} from "../../domain/entities/PlatformConfig";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import type { ProjectMoodboardRepository } from "../../domain/repositories/ProjectMoodboardRepository";
import type { UserStyleProfileRepository } from "../../domain/repositories/UserStyleProfileRepository";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { PlatformConfigRepository } from "../../domain/repositories/PlatformConfigRepository";
import type { ProjectPresetRepository } from "../../domain/repositories/ProjectPresetRepository";
import type { IFileStorage } from "../../infra/storage/IFileStorage";
import type { GetLlmCatalog } from "./GetLlmCatalog";
import type { GetLlmPromptConfig } from "./GetLlmPromptConfig";
import type { ResolvePipelineModelLock } from "./ResolvePipelineModelLock";
import type { ResolveBrandContext } from "./ResolveBrandContext";
import { ResolveBrandDocumentContext, BRAND_DOC_WAIT_FOR_PENDING_MS } from "./ResolveBrandDocumentContext";
import { buildStyleContextBlock } from "../llm/styleContextBuilder";
import { composeSystemPromptWithLayers, type PromptLayerTraceEntry, type TemplateResolution } from "../llm/systemPromptComposer";
import {
    buildGroundedDataContextLayer,
    buildGlobalBrandLayer,
    buildBrandDocumentLayerD,
    buildPresetLayerFromPreset,
} from "../llm/systemPromptLayers";
import { resolveFilesystemTemplateSkills } from "../llm/templateSkillsLayer";
import { buildFocusedModeSystemAddendum } from "../llm/focusedPrompt";
import { buildOutputBudgetPolicy } from "../llm/llmMessageBuilder";
import { dedupeModelsById, resolveComposerCascade } from "../llm/catalogModels";
import { buildProjectLayerDContext, PROJECT_LAYER_D_WAIT_FOR_PENDING_MS } from "../documents/projectLayerDContext";
import { env } from "../../config";
import { tracePromptLayers } from "../services/PipelineTrace";

/**
 * I10 of the SSOT program (see docs/SSOT_REFACTOR_PROGRESS.md) — extracted verbatim (pure move,
 * no logic change) from the `resolveContext()` function nested inside
 * `apps/api/src/presentation/http/routes/llmRoutes.ts`'s `createLlmRoutes()`. This is the SOLE
 * composer call site: every one of `/llm/prompt-preview`, `/llm/chat-preview`, and
 * `/llm/chat-preview/stream` calls this exact resolver to pick the provider/model and build the
 * composed system prompt. Before this move it existed only as a closure over repositories
 * constructed inline in the route factory, was untestable in isolation, and could not be reused
 * by any future increment (I12+) without duplicating ~250 lines. Closure-captured dependencies
 * became constructor parameters; nothing about the resolution logic itself changed.
 */
export type LlmRuntimeContext = {
    providerCatalog: {
        provider: string;
        baseUrl: string;
        apiType?: "openai-compatible" | "anthropic-compatible" | "custom";
        authType?: "api-key" | "bearer" | "none";
        models: Array<{
            id: string;
            role: string;
            capabilities: string[];
            isDefault: boolean;
            isFallback: boolean;
            isActive: boolean;
            displayName?: string;
            description?: string;
            promptTemplate?: string;
            focusPromptTemplate?: string;
            supportedParameters?: string[];
            priceTier?: "free" | "€" | "€€" | "€€€" | "€€€€";
            priceInputUsdPerM?: number;
            priceOutputUsdPerM?: number;
        }>;
    };
    modelId: string;
    projectPresetId?: string;
    promptConfigId?: string;
    prePromptTemplate?: string;
    systemPrompt: string;
    /** Structured breakdown of systemPrompt — same spans, persisted in promptingTrace.layers. */
    promptLayers: PromptLayerTraceEntry[];
};

export interface ResolvePromptExecutionInput {
    projectId: string;
    userId: string;
    pipelineRole: string;
    provider?: string;
    model?: string;
    capability?: string;
    assetIds?: string[];
    systemPrompt?: string;
    /** BCP-47 output language for Layer L injection (e.g. "it", "en"). When absent, Layer L is omitted. */
    outputLanguage?: string;
    focusedMode?: {
        focusContext: LlmFocusContext;
        pageMap?: Parameters<typeof buildFocusedModeSystemAddendum>[1];
    };
    /**
     * I14 of the SSOT program (strict cutover wave 2) — when present, provider/model selection
     * is governed by this PipelineRun's frozen modelLock via `ResolvePipelineModelLock.dispatch()`
     * instead of the legacy inline cascade below, and blocks (409) rather than substituting when
     * the lock is unavailable. Omitted: 100% unchanged legacy path.
     */
    pipelineRunId?: string;
}

export class ResolvePromptExecution {
    constructor(
        private readonly getLlmCatalog: GetLlmCatalog,
        private readonly getLlmPromptConfig: GetLlmPromptConfig,
        private readonly moodboardRepository: ProjectMoodboardRepository,
        private readonly userStyleProfileRepository: UserStyleProfileRepository,
        private readonly projectRepository: ProjectRepository,
        private readonly platformConfigRepo: PlatformConfigRepository,
        private readonly assetRepository: ProjectAssetRepository,
        private readonly presetRepository: ProjectPresetRepository,
        private readonly resolveBrandDocumentContext: ResolveBrandDocumentContext,
        private readonly resolveBrandContext: ResolveBrandContext,
        private readonly resolvePipelineModelLock: ResolvePipelineModelLock,
        private readonly storage: IFileStorage,
    ) { }

    async execute(input: ResolvePromptExecutionInput): Promise<LlmRuntimeContext> {
        const catalog = await this.getLlmCatalog.execute();
        const promptConfig = await this.getLlmPromptConfig.execute(input.projectId);
        const [moodboard, userProfile, project, platformConfig, projectAssets] = await Promise.all([
            this.moodboardRepository.findByProjectId(input.projectId),
            this.userStyleProfileRepository.findByUserId(input.userId),
            this.projectRepository.findByIdForUser(input.projectId, input.userId),
            this.platformConfigRepo.get().catch(() => null),
            this.assetRepository.listByProject(input.projectId, input.userId).catch(() => [] as Awaited<ReturnType<typeof this.assetRepository.listByProject>>),
        ]);
        const presetRaw = project?.presetId
            ? (await this.presetRepository.findById(project.presetId).catch(() => null)) ?? PRESET_MAP.get(project.presetId) ?? null
            : null;
        // PP-018 pre-reseed safety: Mongo presets stored before viewportModel existed inherit
        // the static catalog's viewport framing instead of degrading to document_scroll.
        const preset = presetRaw && project?.presetId ? withStaticViewportFallback(presetRaw, project.presetId) : presetRaw;

        const productKey = project?.presetId ?? "default";
        const governanceResolved = resolveGovernanceSystemPromptFromConfig(platformConfig, productKey, "generationSystem");
        const governanceSystemPrompt = governanceResolved.value || undefined;
        const governanceFocusedBasePrompt = resolveGovernanceSystemPromptFromConfig(platformConfig, productKey, "focusedEditSystem").value || undefined;
        const attachmentPolicy = resolveAttachmentPolicyFromConfig(platformConfig, productKey);
        const documentContextPolicy = resolveDocumentContextPolicyFromConfig(platformConfig, productKey);

        const styleBlock = buildStyleContextBlock(userProfile, moodboard);
        const presetLayer = buildPresetLayerFromPreset(preset ?? undefined);
        const selectedAssetIds = new Set(input.assetIds ?? []);
        const contextAssets = selectedAssetIds.size > 0
            ? projectAssets.filter((asset) => selectedAssetIds.has(asset.id))
            : projectAssets;

        if (selectedAssetIds.size > 0) {
            if (contextAssets.length > attachmentPolicy.maxAttachmentsPerPrompt) {
                throw new HttpError(
                    `Too many attachments selected (max ${attachmentPolicy.maxAttachmentsPerPrompt})`,
                    { statusCode: 422, code: "ATTACHMENT_LIMIT_EXCEEDED" },
                );
            }

            const oversizedAsset = contextAssets.find((asset) => asset.fileSize > attachmentPolicy.maxFileSizeBytes);
            if (oversizedAsset) {
                throw new HttpError(
                    `Attachment exceeds per-file size limit (${oversizedAsset.originalName})`,
                    { statusCode: 413, code: "ATTACHMENT_FILE_TOO_LARGE" },
                );
            }

            const selectedTotalBytes = contextAssets.reduce((acc, asset) => acc + asset.fileSize, 0);
            if (selectedTotalBytes > attachmentPolicy.maxTotalBytes) {
                throw new HttpError(
                    "Selected attachments exceed total size limit",
                    { statusCode: 422, code: "ATTACHMENT_TOTAL_SIZE_EXCEEDED" },
                );
            }
        }

        // Reusable brand documents (analysed once, cached) claim the Layer D budget first;
        // project attachments fill the remainder. Failure never blocks generation.
        // The enrichment content is functional to this generation, so in-flight (pending)
        // analyses are AWAITED (bounded) — never treated as fire-and-forget.
        const brandDocuments = await this.resolveBrandDocumentContext
            .execute({ userId: input.userId, projectId: input.projectId, waitForPendingMs: BRAND_DOC_WAIT_FOR_PENDING_MS })
            .catch(() => []);
        const brandDocumentLayer = buildBrandDocumentLayerD(brandDocuments);
        const remainingLayerDBudget = Math.max(0, env.ENRICHMENT_LAYER_D_MAX_CHARS - brandDocumentLayer.length);
        const projectLayerD = remainingLayerDBudget > 0 && env.enrichmentInjectLayerD
            ? await buildProjectLayerDContext({
                assetRepository: this.assetRepository,
                storage: this.storage,
                projectId: input.projectId,
                userId: input.userId,
                assets: contextAssets,
                includeUnenrichedAssets: selectedAssetIds.size > 0,
                maxChars: remainingLayerDBudget,
                maxAssets: documentContextPolicy.maxAssetsPerPrompt,
                fallbackInlineExtractionMaxAssets: documentContextPolicy.fallbackInlineExtractionMaxAssets,
                waitForPendingMs: env.enrichmentEnabled ? PROJECT_LAYER_D_WAIT_FOR_PENDING_MS : 0,
            })
            : { layer: "", assets: contextAssets, documentNames: [] };
        const documentContextLayer = [brandDocumentLayer, projectLayerD.layer].filter(Boolean).join("\n\n");
        // Alpha guardrail: grounded dataset Layer X is restricted to explicit
        // data-dashboard projects and is not injected into the standard website flow.
        const dataContextLayer = project?.presetId === "data-dashboard"
            ? buildGroundedDataContextLayer(projectLayerD.assets)
            : "";

        let providerCatalog: (typeof catalog.providers)[number] | undefined;
        let providerModels: (typeof catalog.providers)[number]["models"] = [];
        let roleModel: (typeof catalog.providers)[number]["models"][number] | undefined;
        let pipelineRunLocked = false;

        // I14 strict cutover wave 2: a PipelineRun's frozen modelLock governs dispatch instead of
        // the legacy cascade. dispatch() re-validates the lock against the live catalog and never
        // substitutes a different model — a stale/deactivated lock blocks (409) rather than
        // silently falling back to the cascade below. Gated on PIPELINE_RUN_ENABLED too, not just
        // the presence of pipelineRunId: this is the master rollback lever's whole point —
        // flipping the flag off must revert EVERY call site to legacy behavior, even one that
        // (incorrectly, or from a stale client) still sends a pipelineRunId.
        //
        // The lock is single-use: it certifies the run's own generation, the one whose
        // canonicalBrief contentHash the run attests. Once dispatched, dispatch() reports
        // lockApplies:false and we fall through to the cascade, so the model the user picks in
        // the selector governs every later turn (owner decision, 2026-08-26). Before this, a run
        // pinned its model for the whole conversation and discarded the selector in silence.
        let lockedSelection: { providerId: string; modelId: string } | null = null;
        if (input.pipelineRunId && env.pipelineRunEnabled) {
            const stage = input.focusedMode ? "focused_edit" : "generate";
            const { run, blocked, lockApplies } = await this.resolvePipelineModelLock.dispatch({
                runId: input.pipelineRunId,
                ownerUserId: input.userId,
                projectId: input.projectId,
                stage,
            });

            if (blocked) {
                throw new HttpError(`Pipeline model lock unavailable for ${stage} stage: ${blocked.code}`, {
                    statusCode: 409,
                    code: blocked.code,
                });
            }

            if (lockApplies) {
                lockedSelection = {
                    providerId: run.modelLock.effective.providerId,
                    modelId: run.modelLock.effective.modelId,
                };
            }
        }

        if (lockedSelection) {
            const lockedProviderId = lockedSelection.providerId;
            const lockedModelId = lockedSelection.modelId;
            providerCatalog = catalog.providers.find((p) => p.provider === lockedProviderId);
            if (!providerCatalog) {
                throw new HttpError(`Locked provider is no longer in the active catalog: ${lockedProviderId}`, {
                    statusCode: 409,
                    code: "MODEL_LOCK_UNAVAILABLE",
                });
            }

            providerModels = dedupeModelsById(providerCatalog.models);
            roleModel = providerModels.find((m) => m.id === lockedModelId);
            if (!roleModel) {
                throw new HttpError(`Locked model is no longer in the active catalog: ${lockedModelId}`, {
                    statusCode: 409,
                    code: "MODEL_LOCK_UNAVAILABLE",
                });
            }

            pipelineRunLocked = true;
        } else {
            // The cascade itself lives in catalogModels.ts, next to the other model-resolution
            // rules, instead of being hand-inlined here — this call site serves 100% of real
            // generation traffic and was the last one still carrying its own private copy.
            const cascade = resolveComposerCascade({
                providers: catalog.providers,
                requestedProvider: input.provider,
                requestedModel: input.model,
                capability: input.capability,
                pipelineRole: input.pipelineRole,
                envDefaultProvider: env.LLM_DEFAULT_PROVIDER,
            });

            if (!cascade.providerCatalog) {
                throw new Error("No active LLM provider catalog found");
            }

            // The catalog is the source of truth for what may be dispatched, so it is verified,
            // not consulted. This branch used to return `input.model` verbatim for any
            // openai-compatible provider — "trust the requested id directly" — which meant an
            // operator switching a model off governed what the UI offered but not what the API
            // accepted. Every other resolution path in the codebase already filters on isActive;
            // this one opted out, and an SSOT that one path opts out of is not a source of truth.
            //
            // The original justification was propagation lag: a freshly discovered id might not
            // be in the hydrated list yet. That reason is void now that discovery no longer
            // activates anything — a model nobody has approved is not usable regardless of how
            // fresh it is.
            if (cascade.requestedProviderUnavailable || cascade.requestedModelUnavailable) {
                throw new HttpError(
                    `Requested model ${input.provider ?? "?"}/${input.model ?? "?"} is not available in the catalog.`,
                    {
                        statusCode: 409,
                        code: MODEL_NOT_AVAILABLE,
                        userMessage: "Il modello selezionato non e piu disponibile. Ricarica l'elenco e scegline un altro.",
                        details: {
                            requestedProvider: input.provider,
                            requestedModel: input.model,
                            reason: cascade.requestedProviderUnavailable ? "provider-inactive" : "model-inactive-or-unknown",
                        },
                    },
                );
            }

            providerCatalog = cascade.providerCatalog;
            providerModels = cascade.providerModels;
            roleModel = cascade.roleModel;
        }

        const effectivePrePromptTemplate = [
            promptConfig.enabled ? promptConfig.prePromptTemplate : undefined,
            roleModel?.promptTemplate,
        ]
            .filter((value): value is string => Boolean(value && value.trim()))
            .join("\n\n---\n\n");

        // Layer T: re-inject the Layer Φ format signal persisted at classify time.
        // buildLayerT self-suppresses when presetId is set — but ONLY a preset that actually
        // carries a systemPromptModule "covers" the format in Layer B. A module-less generic
        // preset (e.g. "neutral", 0 chars) must NOT suppress the formatHint fallback, or the
        // format directives vanish from the prompt entirely (B thin AND T empty).
        const presetCoversFormat = Boolean(preset?.outputSpec.systemPromptModule?.trim());
        const templateResolution: TemplateResolution | null = project?.templateResolution
            ? {
                presetId: presetCoversFormat ? (project.presetId ?? null) : null,
                userTemplateId: null,
                formatHint: (project.templateResolution.formatHint ?? null) as TemplateResolution["formatHint"],
                confidence: project.templateResolution.confidence,
                reasoning: project.templateResolution.reasoning,
                source: project.templateResolution.source,
            }
            : null;

        const brandContext = await this.resolveBrandContext.execute(
            { userId: input.userId, projectId: input.projectId },
        ).catch(() => ({ entries: [], hasMustUse: false }));
        const brandContextLayer = buildGlobalBrandLayer(brandContext, { maxChars: 4000 });

        // Layer L (OUTPUT LANGUAGE) resolution chain: explicit persisted project language
        // (from zero-effort/Vibe intake) → client UI language sent with the request → none
        // (model default = English). See OUTPUT_LANGUAGE_CONTROL_SPEC.md.
        const resolvedOutputLanguage = project?.outputLanguage || input.outputLanguage || null;
        const outputLanguageSource = project?.outputLanguage
            ? "project-config"
            : input.outputLanguage ? "request-ui-language" : "empty";
        const templateSkills = resolveFilesystemTemplateSkills({
            presetId: project?.presetId,
        });
        const governanceFocusedSystemPrompt = [
            roleModel?.focusPromptTemplate,
            governanceFocusedBasePrompt,
        ]
            .filter((value): value is string => Boolean(value && value.trim()))
            .join("\n\n");
        const focusedModeLayer = input.focusedMode
            ? [
                buildFocusedModeSystemAddendum(
                    input.focusedMode.focusContext,
                    input.focusedMode.pageMap,
                ),
                governanceFocusedSystemPrompt,
            ].filter(Boolean).join("\n\n")
            : "";

        const layerSources: Partial<Record<import("../llm/systemPromptComposer").PromptLayerId, string>> = {
            L: outputLanguageSource,
            B: project?.presetId ? "preset-catalog" : "code-default",
            V: project?.serviceConfig?.forms?.enabled
                ? "project-service-config"
                : project?.presetId === "form" ? "preset-capability" : "empty",
            S: templateSkills
                ? `filesystem-template-skills:${templateSkills.presetId}:${templateSkills.documents.map((doc) => doc.id).join(",")}`
                : "empty",
            T: templateResolution?.formatHint ? "project-config" : "empty",
            E: promptConfig.enabled && promptConfig.prePromptTemplate && roleModel?.promptTemplate
                ? "project-config+model-template"
                : roleModel?.promptTemplate ? "model-template"
                    : promptConfig.enabled && promptConfig.prePromptTemplate ? "project-config" : "empty",
            F: governanceResolved.source,
            R: input.systemPrompt ? "request" : "empty",
            Q: input.focusedMode
                ? governanceFocusedSystemPrompt ? "focused-mode+governance" : "focused-mode"
                : "empty",
        };
        const composedLayers = composeSystemPromptWithLayers({
            presetId: project?.presetId,
            presetLayer,
            enabledServiceCapabilities: project?.serviceConfig?.forms?.enabled ? ["forms"] : [],
            skillsLayer: templateSkills?.layer,
            templateResolution,
            styleBlock,
            brandContextLayer: brandContextLayer || undefined,
            documentContextLayer: documentContextLayer || undefined,
            dataContextLayer: dataContextLayer || undefined,
            prePromptTemplate: effectivePrePromptTemplate || undefined,
            outputBudgetPolicy: buildOutputBudgetPolicy(),
            requestSystemPrompt: input.systemPrompt,
            governanceSystemPrompt,
            focusedModeLayer,
            outputLanguage: resolvedOutputLanguage,
            sources: layerSources,
        });
        const systemPrompt = composedLayers.composed;

        // Rule Zero: the composed prompt must be reconstructable from the log alone.
        tracePromptLayers({
            runId: input.pipelineRunId,
            projectId: input.projectId,

            layers: composedLayers.layers,
            totalChars: systemPrompt.length,
        });

        if (!roleModel) {
            throw new Error("No active model available for requested role");
        }

        return {
            providerCatalog: { ...providerCatalog, models: providerModels },
            modelId: roleModel.id,
            projectPresetId: project?.presetId,
            promptConfigId: promptConfig.id,
            prePromptTemplate: effectivePrePromptTemplate || undefined,
            systemPrompt,
            promptLayers: composedLayers.layers,
        };
    }
}
