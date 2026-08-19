import { createHash } from "crypto";
import type { PipelineEntryMode, PipelineModelLock, OptimizationPolicy, PipelineStage } from "@andy-code-cat/contracts";
import type { LlmProviderCatalog } from "../../domain/entities/LlmCatalog";
import type { PipelineRun, PipelineRunBlockedDetail } from "../../domain/entities/PipelineRun";
import type { NewPipelineRun, PipelineRunRepository } from "../../domain/repositories/PipelineRunRepository";
import { resolveModelSelection } from "../llm/modelSelection";
import type { GetLlmCatalog } from "./GetLlmCatalog";

const FALLBACK_PROVIDER = "siliconflow";
const FALLBACK_MODEL = "MiniMaxAI/MiniMax-M3";

/**
 * Deterministic fingerprint of the currently active provider/model set. There is no live
 * "catalog revision" concept anywhere in this codebase yet (I8 scope note — see
 * docs/SSOT_REFACTOR_PROGRESS.md) so this hash stands in as the `catalogRevision` recorded
 * on a `PipelineModelLock`: two calls made against an unchanged active catalog produce the
 * same revision; any activation/deactivation of a provider or model changes it.
 */
export function computeCatalogRevision(providers: LlmProviderCatalog[]): string {
    const fingerprint = providers
        .map((p) => `${p.provider}:${p.models.filter((m) => m.isActive).map((m) => m.id).sort().join(",")}`)
        .sort()
        .join("|");
    return createHash("sha256").update(fingerprint).digest("hex").slice(0, 16);
}

export interface CreatePipelineRunInput {
    projectId: string;
    ownerUserId: string;
    conversationId?: string;
    entryMode: PipelineEntryMode;
    requestedProviderId?: string;
    requestedModelId?: string;
    optimizationPolicy: OptimizationPolicy;
}

export interface DispatchStageInput {
    runId: string;
    ownerUserId: string;
    stage: PipelineStage;
}

export interface DispatchStageResult {
    run: PipelineRun;
    blocked: PipelineRunBlockedDetail | null;
}

/**
 * I8 of the SSOT program. `createRun()` freezes a `PipelineModelLock` against the live
 * catalog at run-creation time; `dispatch()` re-validates that lock's `effective`
 * provider/model are still active before a stage is allowed to proceed, and blocks
 * (never silently substitutes a different model) when they are not.
 *
 * Additive and unconsumed in this batch: no existing route or use case calls this yet.
 * `createRun()` reuses the exact "vibe-cascade" resolution shape already pinned by I1-I3's
 * `resolveModelSelection`, so a run created here picks the same model a legacy Vibe call
 * would pick against the same catalog + request — not a new decision algorithm.
 */
export class ResolvePipelineModelLock {
    constructor(
        private readonly repository: PipelineRunRepository,
        private readonly getLlmCatalog: GetLlmCatalog,
    ) { }

    async createRun(input: CreatePipelineRunInput): Promise<PipelineRun> {
        const catalog = await this.getLlmCatalog.execute();
        const activeProviders = catalog.providers.filter((p) => p.isActive);
        const catalogRevision = computeCatalogRevision(activeProviders);

        const decision = resolveModelSelection({
            profile: "vibe-cascade",
            activeProviders,
            requestedProvider: input.requestedProviderId,
            requestedModel: input.requestedModelId,
            fallbackProvider: FALLBACK_PROVIDER,
            hardcodedFallbackModel: FALLBACK_MODEL,
            requireOverrideInCatalog: true,
            gateOverrideOnOpenAiCompatible: false,
            policy: "legacy",
        });

        const modelLock: PipelineModelLock = {
            policy: "legacy",
            requested: {
                providerId: input.requestedProviderId ?? decision.effective.provider,
                modelId: input.requestedModelId ?? decision.effective.model,
                catalogRevision,
            },
            effective: {
                providerId: decision.effective.provider,
                modelId: decision.effective.model,
            },
            selectedAt: new Date().toISOString(),
            selectedBy: input.requestedProviderId || input.requestedModelId ? "user" : "catalog-proposal",
        };

        const newRun: NewPipelineRun = {
            projectId: input.projectId,
            ownerUserId: input.ownerUserId,
            conversationId: input.conversationId,
            entryMode: input.entryMode,
            modelLock,
            optimizationPolicy: input.optimizationPolicy,
        };

        return this.repository.create(newRun);
    }

    async dispatch(input: DispatchStageInput): Promise<DispatchStageResult> {
        const run = await this.repository.findByIdForUser(input.runId, input.ownerUserId);
        if (!run) {
            throw new Error(`PipelineRun not found: ${input.runId}`);
        }

        const catalog = await this.getLlmCatalog.execute();
        const activeProviders = catalog.providers.filter((p) => p.isActive);
        const providerCatalog = activeProviders.find((p) => p.provider === run.modelLock.effective.providerId);
        const modelStillActive = providerCatalog?.models.some(
            (m) => m.isActive && m.id === run.modelLock.effective.modelId,
        );

        if (!providerCatalog || !modelStillActive) {
            const blocked: PipelineRunBlockedDetail = {
                code: "MODEL_LOCK_UNAVAILABLE",
                stage: input.stage,
                at: new Date(),
            };
            const blockedRun = await this.repository.setStatus(run.id, "blocked", {
                code: blocked.code,
                stage: blocked.stage,
            });
            return { run: blockedRun, blocked };
        }

        return { run, blocked: null };
    }
}
