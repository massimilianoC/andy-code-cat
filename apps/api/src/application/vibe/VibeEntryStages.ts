/**
 * The three Vibe entry stages — classify, prefill, workspace launch — as application services.
 *
 * Each lived in its HTTP handler (vibecoreRoutes `/vibecore/classify`, `/vibecore/prefill`,
 * pipelineRoutes `/pipeline/launch-workspace`) together with the work-session bookkeeping, the
 * intake and proposal records and the Layer D assembly that make the stage traceable. A background
 * run executes the same stages without a browser (BACKGROUND_RUNS.md §1: "the interactive flow with
 * the clicks taken out"), so the stage moves here and the handler keeps only what is HTTP:
 * parsing, the attachment policy refusals, the response shape. One implementation per stage
 * (AGENTS.md Rule Zero).
 */
import type { FormatHint, GuidedLaunchInput, LaunchWorkspacePipelineInput, VibeClassifyResponse, VibePrefillResponse } from "@andy-code-cat/contracts";
import { env } from "../../config";
import type { ProductDocumentContextPolicy } from "../../domain/entities/PlatformConfig";
import { diffFormFields } from "../../domain/entities/ZeroEffortForm";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import type { VibeIntakeRepository } from "../../domain/repositories/VibeIntakeRepository";
import type { ZeroEffortFormProposalRepository } from "../../domain/repositories/ZeroEffortFormProposalRepository";
import type { IFileStorage } from "../../infra/storage/IFileStorage";
import { HttpError } from "../../presentation/http/errors/httpError";
import { buildProjectLayerDContext, PROJECT_LAYER_D_WAIT_FOR_PENDING_MS } from "../documents/projectLayerDContext";
import { buildBrandDocumentLayerD, buildGroundedDataContextLayer } from "../llm/systemPromptLayers";
import { ExecutionLogger } from "../services/ExecutionLogger";
import type { LaunchWorkspacePipeline } from "../use-cases/LaunchWorkspacePipeline";
import type { OpenWorkSession } from "../use-cases/OpenWorkSession";
import { BRAND_DOC_WAIT_FOR_PENDING_MS, type ResolveBrandDocumentContext } from "../use-cases/ResolveBrandDocumentContext";
import type { VibeClassify } from "../use-cases/VibeClassify";
import type { VibePrefill } from "../use-cases/VibePrefill";

export interface VibeAttachmentMeta {
    filename: string;
    mimeType: string;
    sizeBytes: number;
}

type GenerationMode = "auto" | "website" | "data_dashboard";

// ── Classify ────────────────────────────────────────────────────────────────

export class VibeClassifyStage {
    constructor(
        private readonly vibeClassify: VibeClassify,
        private readonly openWorkSession: OpenWorkSession,
        private readonly vibeIntakeRepository: VibeIntakeRepository,
        private readonly projectRepository: ProjectRepository,
    ) { }

    async execute(input: {
        userId: string;
        projectId: string;
        prompt: string;
        attachmentMeta: VibeAttachmentMeta[];
        generationMode?: GenerationMode;
        provider?: string;
        model?: string;
        /** A session the caller explicitly continues; otherwise this stage starts a new intent. */
        continuingSessionId?: string;
    }): Promise<{ result: VibeClassifyResponse; workSessionId?: string }> {
        const { userId, projectId } = input;
        // The session opens here, at the first tool the user engages. A fresh Vibe prompt IS a
        // new intent, so this stage starts one and closes whatever was still open on the project —
        // unless the caller explicitly named a session to continue, which only a deliberate
        // resubmission does. Never throws: the generation proceeds untraced if the store is down.
        const workSession = input.continuingSessionId
            ? await this.openWorkSession.reuseOrOpen(input.continuingSessionId, { userId, entryMode: "vibe", projectId })
            : await this.openWorkSession.startIntent({ userId, entryMode: "vibe", projectId });

        // Recorded BEFORE classify dispatches: a request that dies in the provider must still
        // prove it was made — nothing else holds the prompt as the user actually typed it.
        if (workSession) {
            await this.vibeIntakeRepository.record({
                workSessionId: workSession.id,
                userId,
                projectId,
                prompt: input.prompt,
                attachments: input.attachmentMeta.map((a) => ({
                    filename: a.filename,
                    mimeType: a.mimeType,
                    sizeBytes: a.sizeBytes,
                })),
                requestedProvider: input.provider,
                requestedModel: input.model,
                generationMode: input.generationMode,
            }).catch(() => undefined);
        }

        const result = await this.vibeClassify.execute({
            prompt: input.prompt,
            attachmentMeta: input.attachmentMeta,
            generationMode: input.generationMode,
            provider: input.provider,
            model: input.model,
            userId,
            projectId,
            workSessionId: workSession?.id,
        });

        // Persist the Layer T signal on the project so subsequent generation turns re-inject the
        // same format guidance. Layer T self-suppresses when the project later gains a presetId.
        if (result.formatHint && !result.skipped) {
            await this.projectRepository.update(projectId, userId, {
                templateResolution: {
                    formatHint: result.formatHint,
                    confidence: result.confidence,
                    reasoning: result.reasoning,
                    source: "layer_phi",
                },
            }).catch(() => null);
        }

        return { result, workSessionId: workSession?.id };
    }
}

// ── Prefill ─────────────────────────────────────────────────────────────────

export class VibePrefillStage {
    constructor(
        private readonly vibePrefill: VibePrefill,
        private readonly openWorkSession: OpenWorkSession,
        private readonly assetRepository: ProjectAssetRepository,
        private readonly storage: IFileStorage,
        private readonly resolveBrandDocumentContext: ResolveBrandDocumentContext,
        private readonly zeroEffortFormProposalRepository: ZeroEffortFormProposalRepository,
    ) { }

    async execute(input: {
        userId: string;
        projectId: string;
        prompt: string;
        attachmentMeta: VibeAttachmentMeta[];
        documentContextPolicy: ProductDocumentContextPolicy;
        generationMode?: GenerationMode;
        templateId?: string | null;
        formatHint?: string | null;
        provider?: string;
        model?: string;
        uiLanguage?: string;
        continuingSessionId?: string;
    }): Promise<{ result: VibePrefillResponse; workSessionId?: string }> {
        const { userId, projectId, attachmentMeta, documentContextPolicy } = input;
        const hasRequestAttachments = attachmentMeta.length > 0;
        let layerDContext: string | undefined;
        let layerXDataContext: string | undefined;
        const layerDocNames: string[] = [];
        let projectLayerDDocumentNames: string[] = [];

        // Layer D injection from the (ownership-verified) project's assets.
        let assets = await this.assetRepository.listByProject(projectId, userId).catch(() => []);

        if (env.enrichmentInjectLayerD) {
            const projectLayerD = await buildProjectLayerDContext({
                assetRepository: this.assetRepository,
                storage: this.storage,
                projectId,
                userId,
                assets,
                maxChars: 8000,
                maxAssets: documentContextPolicy.maxAssetsPerPrompt,
                fallbackInlineExtractionMaxAssets: documentContextPolicy.fallbackInlineExtractionMaxAssets,
                waitForPendingMs: env.enrichmentEnabled ? PROJECT_LAYER_D_WAIT_FOR_PENDING_MS : 0,
            }).catch((error) => {
                if (hasRequestAttachments) {
                    throw new HttpError("Attachment context extraction failed", {
                        statusCode: 503,
                        code: "ATTACHMENT_CONTEXT_UNAVAILABLE",
                        userMessage: "Non sono riuscito a estrarre il contesto dagli allegati. Riprova tra poco.",
                        details: error instanceof Error ? { message: error.message } : undefined,
                    });
                }
                return { layer: "", assets, documentNames: [] as string[] };
            });
            assets = projectLayerD.assets;
            layerDContext = projectLayerD.layer || undefined;
            projectLayerDDocumentNames = projectLayerD.documentNames;
            projectLayerD.documentNames.forEach((name) => layerDocNames.push(name));
        }

        if (hasRequestAttachments) {
            assertAttachmentContextReady({ attachmentMeta, assets, inlineDocumentNames: projectLayerDDocumentNames });
        }

        if (input.generationMode === "data_dashboard" || input.templateId === "data-dashboard" || input.formatHint === "analytics_dashboard") {
            const groundedData = buildGroundedDataContextLayer(assets, {
                maxChars: 5000,
                maxAssets: documentContextPolicy.maxAssetsPerPrompt,
            });
            if (groundedData) {
                layerXDataContext = groundedData;
            }
        }

        // Reusable brand documents (user/platform scope) apply to every project — even a freshly
        // created one — so the brand book guides the prefill from intake. In-flight analyses are
        // awaited (bounded): the prefill quality depends on them.
        const brandDocuments = await this.resolveBrandDocumentContext
            .execute({ userId, projectId, waitForPendingMs: BRAND_DOC_WAIT_FOR_PENDING_MS })
            .catch(() => []);
        const brandDocumentLayer = buildBrandDocumentLayerD(brandDocuments, { maxChars: 6000 });
        if (brandDocumentLayer) {
            layerDContext = [brandDocumentLayer, layerDContext].filter(Boolean).join("\n\n");
            brandDocuments.forEach((d) => layerDocNames.push(d.title));
        }

        // Prefill is the second stage of an intent classify already opened, so it reuses that
        // session rather than starting one; reuseOrOpen only creates when the id is absent,
        // stale or foreign.
        const prefillWorkSession = await this.openWorkSession.reuseOrOpen(
            input.continuingSessionId,
            { userId, entryMode: "zero-effort", projectId },
        );

        const result = await this.vibePrefill.execute({
            prompt: input.prompt,
            workSessionId: prefillWorkSession?.id,
            layerDContext,
            layerXDataContext,
            generationMode: input.generationMode,
            attachmentMeta,
            templateId: input.templateId ?? null,
            formatHint: (input.formatHint ?? null) as FormatHint | null,
            provider: input.provider,
            model: input.model,
            userId,
            projectId,
            uiLanguage: input.uiLanguage,
        });

        // Attach document names that contributed to the brief (informational, shown to user).
        if (layerDocNames.length > 0) {
            result.draft.attachedDocuments = layerDocNames;
        }

        // What the model PROPOSED, so that what is finally launched can later be diffed against it.
        if (prefillWorkSession && !result.skipped) {
            await this.zeroEffortFormProposalRepository.record({
                workSessionId: prefillWorkSession.id,
                userId,
                projectId,
                prefilled: result.draft as unknown as GuidedLaunchInput,
                editedFields: [],
            }).catch(() => undefined);
        }

        return { result, workSessionId: prefillWorkSession?.id };
    }
}

type ProjectAssets = Awaited<ReturnType<ProjectAssetRepository["listByProject"]>>;

function assetHasResolvedContext(asset: ProjectAssets[number], inlineDocumentNames: Set<string>): boolean {
    if (inlineDocumentNames.has(asset.originalName)) return true;
    const trace = asset.enrichmentTrace;
    if (!trace) return false;
    return Boolean(
        trace.renderedFragment ||
        trace.textLayer ||
        trace.structuredData ||
        trace.documentBrief ||
        trace.visualAnalysis ||
        trace.designSignals ||
        trace.provenance.enrichmentStatus === "ready",
    );
}

function assertAttachmentContextReady(input: {
    attachmentMeta: Array<{ filename: string; sizeBytes: number }>;
    assets: ProjectAssets;
    inlineDocumentNames: string[];
}) {
    if (input.attachmentMeta.length === 0) return;

    const inlineDocumentNames = new Set(input.inlineDocumentNames);
    const missing = input.attachmentMeta.filter((meta) => {
        const asset = input.assets.find((candidate) =>
            candidate.originalName === meta.filename &&
            candidate.fileSize === meta.sizeBytes
        );
        return !asset || !assetHasResolvedContext(asset, inlineDocumentNames);
    });

    if (missing.length > 0) {
        throw new HttpError("Attachment context is not ready", {
            statusCode: 503,
            code: "ATTACHMENT_CONTEXT_NOT_READY",
            userMessage: "Sto ancora estraendo il contesto dagli allegati. Riprova tra poco.",
            details: { files: missing.map((item) => item.filename) },
        });
    }
}

// ── Workspace launch ────────────────────────────────────────────────────────

export class WorkspaceLaunchStage {
    constructor(
        private readonly projectRepository: ProjectRepository,
        private readonly openWorkSession: OpenWorkSession,
        private readonly launchWorkspacePipeline: LaunchWorkspacePipeline,
        private readonly zeroEffortFormProposalRepository: ZeroEffortFormProposalRepository,
    ) { }

    async execute(input: {
        userId: string;
        projectId: string;
        intake: LaunchWorkspacePipelineInput;
        continuingSessionId?: string;
    }): Promise<Awaited<ReturnType<LaunchWorkspacePipeline["execute"]>> & { workSessionId?: string }> {
        const { userId, projectId, intake } = input;
        if (intake.presetId || intake.outputLanguage) {
            await this.projectRepository.update(projectId, userId, {
                ...(intake.presetId ? { presetId: intake.presetId } : {}),
                ...(intake.outputLanguage ? { outputLanguage: intake.outputLanguage } : {}),
            }).catch(() => {});
        }

        // The launch is the second half of an intent Vibe already opened, so it joins that
        // session rather than starting one. Without this the brief, the run and the artifact are
        // orphaned from everything upstream of them (certificate §4, hole D).
        const launchSession = await this.openWorkSession.reuseOrOpen(
            input.continuingSessionId,
            { userId, entryMode: "workspace", projectId },
        );

        const result = await this.launchWorkspacePipeline.execute({
            userId,
            projectId,
            intake,
            workSessionId: launchSession?.id,
        });

        // Certificate §3 question 4: the first moment both sides of the comparison exist — the
        // proposal recorded at prefill, and the form as it was launched.
        if (launchSession) {
            await this.zeroEffortFormProposalRepository.listByWorkSession(launchSession.id, userId)
                .then(async (proposals) => {
                    const latest = proposals[proposals.length - 1];
                    if (!latest) return;
                    await this.zeroEffortFormProposalRepository.recordDecision(
                        launchSession.id,
                        userId,
                        { editedFields: diffFormFields(latest.prefilled, intake), projectId },
                    );
                })
                .catch(() => undefined);
        }

        ExecutionLogger.instance.emit({
            projectId,
            conversationId: result.conversationId,
            domain: "system",
            eventType: "workspace_pipeline_prepared",
            level: "info",
            status: "success",
            metadata: {
                mode: "workspace",
                jobId: result.jobId,
                pipelineRunId: result.pipelineRunId,
                workspaceRootPath: result.workspace.rootPath,
            },
        });

        return { ...result, workSessionId: launchSession?.id };
    }
}
