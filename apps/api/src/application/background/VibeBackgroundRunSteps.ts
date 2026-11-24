/**
 * The Vibe flow as background-run steps (BACKGROUND_RUNS.md §1, §3.2, §6) — "the interactive flow
 * with the clicks taken out". Every step calls what the interactive path calls, in the same order
 * and with the same inputs a browser would send:
 *
 *   classifying  → VibeClassifyStage            (POST /vibecore/classify)  + the preset the home applies
 *   briefing     → VibePrefillStage             (POST /vibecore/prefill)   + guidedIntakeFromDraft, auto-approved
 *   launching    → WorkspaceLaunchStage         (POST /pipeline/launch-workspace, optimizationPolicy "skip")
 *   generating   → AddMessage + GenerateArtifact (the workspace auto-send of the run's canonical brief)
 *   snapshotting → the version GenerateArtifact committed and activated, verified against preview_snapshots
 *   publishing   → PublishProject               (POST /publish) + a proposed slug, nothing reserved
 *
 * The run acts as a run principal (userId, projectId, runId): every read and write is scoped by
 * the owner and the run's own project, and `guard` re-checks the owner and the project before
 * every step (§4). Steps are resumable: each looks at what an earlier attempt already produced
 * (the conversation, the journal's idempotency key, the live deployment) before paying for it again.
 */
import {
    classifySlugFormat,
    guidedIntakeFromDraft,
    isPublicSiteSlug,
    launchWorkspacePipelineSchema,
    type LaunchWorkspacePipelineInput,
} from "@andy-code-cat/contracts";
import type { BackgroundRun, BackgroundRunOutputs, BackgroundRunStep } from "../../domain/entities/BackgroundRun";
import type { ProductDocumentContextPolicy } from "../../domain/entities/PlatformConfig";
import type { Project } from "../../domain/entities/Project";
import type { BackgroundRunRepository } from "../../domain/repositories/BackgroundRunRepository";
import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { PipelineRunRepository } from "../../domain/repositories/PipelineRunRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";
import type { SiteDeploymentRepository } from "../../domain/repositories/SiteDeploymentRepository";
import type { UserRepository } from "../../domain/repositories/UserRepository";
import { CHAT_TURN_DEFAULTS } from "../llm/chatTurnDefaults";
import type { AddMessage } from "../use-cases/AddMessage";
import { PROMPT_EXECUTION_IDEMPOTENCY_STALE_MS, type GenerateArtifact } from "../use-cases/GenerateArtifact";
import type { ManageProject } from "../use-cases/ManageProject";
import type { PublishProject } from "../use-cases/PublishProject";
import type { VibeClassifyStage, VibePrefillStage, WorkspaceLaunchStage } from "../vibe/VibeEntryStages";
import {
    BackgroundRunDeferred,
    BackgroundRunStepError,
    RunInterrupt,
    type BackgroundRunStepContext,
    type BackgroundRunSteps,
} from "./BackgroundRunEngine";

/** How often the streamed size of a generation is written to the run (the progress bar). */
const PROGRESS_WRITE_EVERY_MS = 2_000;
/** A previous attempt's generation still in flight: look again after this. */
const GENERATION_IN_FLIGHT_RETRY_MS = 60_000;
const SLUG_MAX = 30;

export interface VibeBackgroundRunDependencies {
    runs: BackgroundRunRepository;
    users: UserRepository;
    projects: ProjectRepository;
    manageProject: ManageProject;
    /** The document-context policy for a project's preset, from the platform configuration. */
    documentContextPolicy: (presetId: string | undefined) => Promise<ProductDocumentContextPolicy>;
    classify: VibeClassifyStage;
    prefill: VibePrefillStage;
    launch: WorkspaceLaunchStage;
    pipelineRuns: PipelineRunRepository;
    conversations: ConversationRepository;
    addMessage: AddMessage;
    generateArtifact: GenerateArtifact;
    snapshots: PreviewSnapshotRepository;
    journal: PromptExecutionLogRepository;
    publishProject: PublishProject;
    deployments: SiteDeploymentRepository;
    /** The address a deployment is shown and shared at (PlatformConfig.publicSites). */
    publicUrlOf: (deployment: { publishId: string; customSlug?: string | null }) => Promise<string>;
    /** Persists the completion notice of a run that reached done or failed. */
    notifyFinished: (run: BackgroundRun, project: Project | null) => Promise<void>;
    generationTimeoutMs: number;
}

/** Idempotency key of a run's generation: one per run, so a resumed worker never pays twice. */
export function backgroundRunGenerationKey(runId: string): string {
    return `bgrun-${runId}-generate`;
}

/** A free-to-propose slug derived from a name: lowercase ASCII, hyphens, 2–30 chars. */
export function slugCandidateFrom(name: string): string | null {
    const base = name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, SLUG_MAX)
        .replace(/-+$/g, "");
    return base.length >= 2 ? base : null;
}

function requireOutput<T>(value: T | undefined, step: BackgroundRunStep, what: string): T {
    if (value === undefined) {
        throw new BackgroundRunStepError(
            "BACKGROUND_RUN_OUTPUT_MISSING",
            `Step ${step} needs the ${what} of an earlier step, which the run does not hold.`,
        );
    }
    return value;
}

export class VibeBackgroundRunSteps implements BackgroundRunSteps {
    constructor(private readonly deps: VibeBackgroundRunDependencies) { }

    async guard({ run }: BackgroundRunStepContext): Promise<void> {
        const owner = await this.deps.users.findById(run.userId);
        if (!owner) {
            throw new BackgroundRunStepError("BACKGROUND_RUN_OWNER_GONE", "The account that started this run no longer exists.");
        }
        if (owner.isBlocked) {
            throw new BackgroundRunStepError("BACKGROUND_RUN_OWNER_BLOCKED", "The account that started this run is blocked.");
        }
        const project = await this.deps.projects.findByIdForUser(run.projectId, run.userId);
        if (!project) {
            throw new BackgroundRunStepError("BACKGROUND_RUN_PROJECT_GONE", "The run's project no longer exists or is no longer owned by its starter.");
        }
    }

    async execute(step: BackgroundRunStep, ctx: BackgroundRunStepContext): Promise<Partial<BackgroundRunOutputs>> {
        switch (step) {
            case "classifying": return this.classify(ctx);
            case "briefing": return this.brief(ctx);
            case "launching": return this.launchWorkspace(ctx);
            case "generating": return this.generate(ctx);
            case "snapshotting": return this.verifySnapshot(ctx);
            case "publishing": return this.publish(ctx);
        }
    }

    async measureCostEur({ run }: BackgroundRunStepContext): Promise<number> {
        // The run owns its project from creation, so the project's journal is the run's cost.
        const summary = await this.deps.journal.summarizeByProject(run.projectId, run.userId);
        return summary.totalCost;
    }

    async onFinished(run: BackgroundRun): Promise<void> {
        const project = await this.deps.projects.findByIdForUser(run.projectId, run.userId).catch(() => null);
        await this.deps.notifyFinished(run, project);
    }

    // ── classifying ────────────────────────────────────────────────────────

    private async classify({ run }: BackgroundRunStepContext): Promise<Partial<BackgroundRunOutputs>> {
        const { result, workSessionId } = await this.deps.classify.execute({
            userId: run.userId,
            projectId: run.projectId,
            prompt: run.input.prompt,
            attachmentMeta: [],
            generationMode: run.input.generationMode,
            provider: run.input.provider,
            model: run.input.model,
        });
        // What the home does with a classification (VibeCoreEntry): the preset it picked becomes
        // the project's, unless the classifier routed to the data-dashboard mode, which the main
        // Vibe flow does not run.
        const dataMode = result.resolvedMode === "data_dashboard";
        const templateId = dataMode ? null : result.templateId;
        if (templateId) {
            await this.deps.manageProject.update({ projectId: run.projectId, userId: run.userId, presetId: templateId });
        }
        return {
            classification: {
                templateId,
                formatHint: dataMode ? null : result.formatHint,
                confidence: result.confidence,
                skipped: result.skipped,
                resolvedMode: result.resolvedMode,
                workSessionId,
            },
        };
    }

    // ── briefing ───────────────────────────────────────────────────────────

    private async brief({ run }: BackgroundRunStepContext): Promise<Partial<BackgroundRunOutputs>> {
        const classification = requireOutput(run.outputs.classification, "briefing", "classification");
        const project = await this.deps.projects.findByIdForUser(run.projectId, run.userId);
        const { result } = await this.deps.prefill.execute({
            userId: run.userId,
            projectId: run.projectId,
            prompt: run.input.prompt,
            attachmentMeta: [],
            documentContextPolicy: await this.deps.documentContextPolicy(project?.presetId),
            generationMode: run.input.generationMode,
            templateId: classification.templateId,
            formatHint: classification.formatHint,
            provider: run.input.provider,
            model: run.input.model,
            uiLanguage: run.input.uiLanguage,
            continuingSessionId: classification.workSessionId,
        });

        // Refuse, do not substitute: a brief the model did not draft is not invented here. The
        // project stays, and the user can complete the brief by hand from the launch page.
        if (result.skipped) {
            throw new BackgroundRunStepError(
                "BACKGROUND_RUN_BRIEF_UNAVAILABLE",
                result.warnings?.length
                    ? `The brief could not be drafted automatically: ${result.warnings.join(" ")}`
                    : "The brief could not be drafted automatically.",
            );
        }

        // The home renames the project after the business the prefill found; so does the run.
        const businessName = result.draft.businessName?.trim();
        let projectName = project?.name;
        if (businessName && businessName.length >= 3) {
            const renamed = await this.deps.manageProject
                .update({ projectId: run.projectId, userId: run.userId, name: businessName.slice(0, 80) })
                .catch(() => null);
            projectName = renamed?.name ?? projectName;
        }

        const intake = launchWorkspacePipelineSchema.safeParse({
            ...guidedIntakeFromDraft(
                result.draft,
                { projectName, defaultOutputLanguage: run.input.uiLanguage ?? "en" },
            ),
            requestedProviderId: run.input.provider ?? undefined,
            requestedModelId: run.input.model ?? undefined,
            // Same as the launch page: the canonical brief is already the structured output of the
            // guided flow, and optimizing it again would rewrite the text the run certifies.
            optimizationPolicy: "skip",
        });
        if (!intake.success) {
            const fields = [...new Set(intake.error.issues.map((issue) => issue.path.join(".")))].join(", ");
            throw new BackgroundRunStepError(
                "BACKGROUND_RUN_BRIEF_INCOMPLETE",
                `The drafted brief is missing what a launch needs (${fields}).`,
            );
        }
        return { brief: { intake: intake.data, warnings: result.warnings } };
    }

    // ── launching ──────────────────────────────────────────────────────────

    private async launchWorkspace({ run }: BackgroundRunStepContext): Promise<Partial<BackgroundRunOutputs>> {
        const brief = requireOutput(run.outputs.brief, "launching", "brief");
        // A previous attempt that launched and died before recording it left a PipelineRun on
        // this project (the project is the run's own): reuse it rather than launch twice.
        const existing = (await this.deps.pipelineRuns.listByProject(run.projectId, run.userId))
            .filter((pipelineRun) => pipelineRun.conversationId && pipelineRun.canonicalBrief)
            .pop();
        if (existing?.conversationId) {
            return { launch: { pipelineRunId: existing.id, conversationId: existing.conversationId } };
        }
        const launched = await this.deps.launch.execute({
            userId: run.userId,
            projectId: run.projectId,
            intake: brief.intake as LaunchWorkspacePipelineInput,
            continuingSessionId: run.outputs.classification?.workSessionId,
        });
        return { launch: { pipelineRunId: launched.pipelineRunId, conversationId: launched.conversationId } };
    }

    // ── generating ─────────────────────────────────────────────────────────

    private async generate({ run, workerId, signal }: BackgroundRunStepContext): Promise<Partial<BackgroundRunOutputs>> {
        const launch = requireOutput(run.outputs.launch, "generating", "launch");
        const pipelineRun = await this.deps.pipelineRuns.findByIdForUser(launch.pipelineRunId, run.userId);
        const brief = pipelineRun?.canonicalBrief?.content;
        if (!pipelineRun || !brief) {
            throw new BackgroundRunStepError("BACKGROUND_RUN_PIPELINE_RUN_MISSING", "The launched pipeline run or its canonical brief is gone.");
        }
        const conversation = await this.deps.conversations.findById(launch.conversationId, run.projectId);
        if (!conversation) {
            throw new BackgroundRunStepError("BACKGROUND_RUN_CONVERSATION_MISSING", "The launched conversation is gone.");
        }

        // Resume: a turn an earlier attempt already persisted is the result.
        const persistedTurn = [...conversation.messages].reverse()
            .find((message) => message.role === "assistant" && message.metadata?.snapshotId);
        const idempotencyKey = backgroundRunGenerationKey(run.id);
        const previous = await this.deps.journal.findActiveByIdempotencyKey(
            run.projectId,
            run.userId,
            idempotencyKey,
            PROMPT_EXECUTION_IDEMPOTENCY_STALE_MS,
        );
        const userMessage = conversation.messages.find((message) => message.role === "user" && message.content === brief);
        if (persistedTurn?.metadata?.snapshotId) {
            return {
                generation: {
                    promptExecutionId: previous?.id ?? "",
                    userMessageId: userMessage?.id ?? "",
                    assistantMessageId: persistedTurn.id,
                    snapshotId: persistedTurn.metadata.snapshotId,
                },
            };
        }
        if (previous?.status === "pending") {
            throw new BackgroundRunDeferred(
                "The generation of an earlier attempt is still in flight.",
                GENERATION_IN_FLIGHT_RETRY_MS,
            );
        }
        if (previous?.status === "succeeded") {
            throw new BackgroundRunStepError(
                "BACKGROUND_RUN_TURN_NOT_PERSISTED",
                "The generation succeeded but its turn was not saved; it is not paid for twice.",
            );
        }

        // The workspace auto-send: the user message first, then the generation of that brief.
        const userMessageId = userMessage?.id ?? (await this.deps.addMessage.execute({
            conversationId: launch.conversationId,
            projectId: run.projectId,
            role: "user",
            content: brief,
        })).id;

        let generatedChars = 0;
        let lastWrite = 0;
        const reportProgress = (chunk: string) => {
            generatedChars += chunk.length;
            const now = Date.now();
            if (now - lastWrite < PROGRESS_WRITE_EVERY_MS) return;
            lastWrite = now;
            void this.deps.runs.recordProgress(run.id, workerId, { generatedChars }, new Date(now)).catch(() => false);
        };

        const timeout = AbortSignal.timeout(this.deps.generationTimeoutMs);
        const outcome = await this.deps.generateArtifact.execute({
            userId: run.userId,
            projectId: run.projectId,
            workSessionId: pipelineRun.workSessionId ?? run.outputs.classification?.workSessionId,
            transport: "stream",
            abortSignal: AbortSignal.any([signal, timeout]),
            sink: { thinking: reportProgress, answer: reportProgress },
            rawBody: {
                message: brief,
                provider: pipelineRun.modelLock.effective.providerId,
                model: pipelineRun.modelLock.effective.modelId,
                capability: CHAT_TURN_DEFAULTS.capability,
                pipelineRole: CHAT_TURN_DEFAULTS.pipelineRole,
                temperature: CHAT_TURN_DEFAULTS.temperature,
                uiLanguage: run.input.uiLanguage,
                history: [],
                pipelineRunId: pipelineRun.id,
                conversationId: launch.conversationId,
                idempotencyKey,
            },
        });

        if (signal.aborted) {
            throw signal.reason instanceof RunInterrupt ? signal.reason : new RunInterrupt("shutdown");
        }
        if (outcome.kind !== "completed") {
            const timedOut = timeout.aborted;
            throw new BackgroundRunStepError(
                timedOut ? "BACKGROUND_RUN_GENERATION_TIMEOUT" : "BACKGROUND_RUN_GENERATION_INTERRUPTED",
                timedOut
                    ? `The generation did not finish within ${Math.round(this.deps.generationTimeoutMs / 60_000)} minutes.`
                    : "The generation stopped before the model finished answering.",
            );
        }
        const persisted = outcome.result.persisted;
        if (persisted?.snapshotError) {
            throw new BackgroundRunStepError(
                persisted.snapshotError.code ?? "BACKGROUND_RUN_VERSION_REFUSED",
                persisted.snapshotError.userMessage ?? "The generated version was refused.",
            );
        }
        if (!persisted?.snapshot) {
            throw new BackgroundRunStepError(
                "BACKGROUND_RUN_NO_ARTIFACT",
                "The model answered without a site (no HTML in the reply).",
            );
        }
        return {
            generation: {
                promptExecutionId: outcome.result.promptExecutionId ?? "",
                userMessageId,
                assistantMessageId: persisted.assistantMessage.id,
                snapshotId: persisted.snapshot.id,
            },
        };
    }

    // ── snapshotting ───────────────────────────────────────────────────────

    private async verifySnapshot({ run }: BackgroundRunStepContext): Promise<Partial<BackgroundRunOutputs>> {
        const generation = requireOutput(run.outputs.generation, "snapshotting", "generation");
        const snapshotId = requireOutput(generation.snapshotId, "snapshotting", "generated version");
        // GenerateArtifact committed and activated the version (AL-047); the store is the authority.
        const snapshot = await this.deps.snapshots.findById(run.projectId, snapshotId);
        if (!snapshot) {
            throw new BackgroundRunStepError("BACKGROUND_RUN_SNAPSHOT_MISSING", "The generated version is not in the store.");
        }
        if (!snapshot.isActive) {
            throw new BackgroundRunStepError(
                "BACKGROUND_RUN_SNAPSHOT_NOT_ACTIVE",
                "The generated version is not the active one, so it is not published.",
            );
        }
        return { snapshot: { snapshotId } };
    }

    // ── publishing ─────────────────────────────────────────────────────────

    private async publish({ run }: BackgroundRunStepContext): Promise<Partial<BackgroundRunOutputs>> {
        const { snapshotId } = requireOutput(run.outputs.snapshot, "publishing", "verified version");
        const project = await this.deps.projects.findByIdForUser(run.projectId, run.userId);
        const live = await this.deps.deployments.findActiveByProjectId(run.projectId);
        const deployment = live && live.userId === run.userId && live.snapshotId === snapshotId
            ? live
            : await this.deps.publishProject.execute({
                projectId: run.projectId,
                userId: run.userId,
                snapshotId,
                presetId: project?.presetId,
                formSettings: project?.serviceConfig?.forms,
            });
        return {
            publish: {
                deploymentId: deployment.id,
                publishId: deployment.publishId,
                publicUrl: await this.deps.publicUrlOf(deployment),
                proposedSlug: await this.proposeSlug(project?.name, deployment.id),
            },
        };
    }

    /** A valid, currently free slug (§6.1). Nothing is reserved: the user adopts it or not. */
    private async proposeSlug(name: string | undefined, deploymentId: string): Promise<string | undefined> {
        const base = name ? slugCandidateFrom(name) : null;
        if (!base) return undefined;
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
            const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
            if (classifySlugFormat(candidate).reason !== "ok" || !isPublicSiteSlug(candidate)) continue;
            const taken = await this.deps.deployments.isCustomSlugTaken(candidate, deploymentId).catch(() => true);
            if (!taken) return candidate;
        }
        return undefined;
    }
}
