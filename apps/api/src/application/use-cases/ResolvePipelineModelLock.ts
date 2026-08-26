import { createHash } from "crypto";
import type { PipelineEntryMode, PipelineModelLock, OptimizationPolicy, PipelineStage } from "@andy-code-cat/contracts";
import type { LlmProviderCatalog } from "../../domain/entities/LlmCatalog";
import type { PipelineRun, PipelineRunBlockedDetail } from "../../domain/entities/PipelineRun";
import type { NewPipelineRun, PipelineRunRepository } from "../../domain/repositories/PipelineRunRepository";
import { resolveModelSelection } from "../llm/modelSelection";
import type { GetLlmCatalog } from "./GetLlmCatalog";
import { HttpError } from "../../presentation/http/errors/httpError";
import { notifyPipelineRunBlocked } from "../llm/pipelineRunNotifications";
import { tracePipeline } from "../services/PipelineTrace";

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
    /**
     * Double-sandbox scoping (matches this repo's other project-scoped resolvers): a run must
     * belong to THIS project, not just this user, or dispatch refuses it — otherwise a request
     * against project A could drive generation off a run created under project B.
     */
    projectId: string;
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
        // Not-found and wrong-project are reported identically (404, same message shape) —
        // mirrors PipelineRunRepository.findByIdForUser's own doc comment: callers must not be
        // able to distinguish "doesn't exist" from "exists but isn't yours to use here".
        if (!run || run.projectId !== input.projectId) {
            throw new HttpError(`PipelineRun not found: ${input.runId}`, {
                statusCode: 404,
                code: "PIPELINE_RUN_NOT_FOUND",
            });
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
            // I17: notify once, on the genuine transition INTO blocked — not on every retry
            // against an already-blocked run (the idempotent re-block below allows those to
            // succeed without erroring, so gating on run.status here is what keeps a client
            // retry loop from spamming duplicate notifications for the same block event).
            if (run.status !== "blocked") {
                notifyPipelineRunBlocked({
                    projectId: run.projectId,
                    userId: run.ownerUserId,
                    runId: run.id,
                    stage: input.stage,
                    code: blocked.code,
                    lockedProviderId: run.modelLock.effective.providerId,
                    lockedModelId: run.modelLock.effective.modelId,
                });
            }
            // Idempotent re-block: a retry against an already-blocked run re-confirms the block
            // (PipelineRun.ts now allows "blocked" -> "blocked") rather than throwing on what
            // used to be an illegal self-transition, which surfaced as a 500 and hid the real
            // MODEL_LOCK_UNAVAILABLE code from the caller.
            const blockedRun = await this.repository.setStatus(run.id, "blocked", {
                code: blocked.code,
                stage: blocked.stage,
            });
            tracePipeline({
                runId: run.id,
                step: "dispatch",
                detail: {
                    stage: input.stage,
                    outcome: "BLOCKED",
                    code: blocked.code,
                    locked: `${run.modelLock.effective.providerId}/${run.modelLock.effective.modelId}`,
                },
            });
            return { run: blockedRun, blocked };
        }

        tracePipeline({
            runId: run.id,
            step: "dispatch",
            detail: {
                stage: input.stage,
                outcome: "ok",
                locked: `${run.modelLock.effective.providerId}/${run.modelLock.effective.modelId}`,
            },
        });
        return { run, blocked: null };
    }
}
