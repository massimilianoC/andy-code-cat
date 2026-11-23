/**
 * CommitArtifactVersion — everything that happens around `CreatePreviewSnapshot` when a version
 * is written: re-parse of a raw reply with empty html, the visibility repairs, normalisation and
 * stable ids, the JavaScript guard for an activated version, the form runtime view, the
 * execution log and the thumbnail job.
 *
 * It lived in the POST /preview-snapshots handler. The generation engine needs the identical
 * write (BACKGROUND_RUNS.md §3.1: the version a generation produces is committed server-side, by
 * the same code for the workspace and the background worker), so it moves here and the route
 * becomes an adapter. `CreatePreviewSnapshot` stays the one path that persists (AL-047); this is
 * the one path that prepares what it persists.
 */
import type { CreatePreviewSnapshotInput, ProjectFormSettingsInput, RuntimePlanV1 } from "@andy-code-cat/contracts";
import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";
import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import { HttpError } from "../../presentation/http/errors/httpError";
import { assertGeneratedJavaScriptSyntax } from "../artifacts/generatedJavaScriptSyntax";
import { repairArtifactsForVisibility } from "../llm/artifactSafetyRepair";
import { injectStableIds, normalizeStoredHtml } from "../llm/htmlIdInjector";
import { tryParseStructuredJson } from "../llm/llmParser";
import { prepareArtifactServices } from "../platform-runtime/prepareArtifactServices";
import { ExecutionLogger } from "../services/ExecutionLogger";
import { SnapshotThumbnailJob } from "../services/SnapshotThumbnailJob";
import type { CreatePreviewSnapshot } from "./CreatePreviewSnapshot";

export type RuntimePreviewSnapshot = PreviewSnapshot & { runtimePlan?: RuntimePlanV1 };

export interface CommitArtifactVersionResult {
    /** AL-045 — false when the write matched its base and no version was added. */
    created: boolean;
    /** The version as the preview runtime needs it (forms compiled); the stored one is canonical. */
    snapshot: RuntimePreviewSnapshot;
}

/** The preview runtime view of a stored version: canonical artifacts plus the configured forms. */
export function withConfiguredFormRuntime(
    snapshot: PreviewSnapshot,
    settings: ProjectFormSettingsInput | undefined,
): RuntimePreviewSnapshot {
    const prepared = prepareArtifactServices({
        artifacts: snapshot.artifacts,
        serviceManifest: snapshot.serviceManifest,
        formSettings: settings,
        delivery: "inline-preview",
    });
    return {
        ...snapshot,
        artifacts: prepared.artifacts,
        runtimePlan: prepared.runtimePlan,
    };
}

export class CommitArtifactVersion {
    constructor(
        private readonly conversationRepository: ConversationRepository,
        private readonly projectRepository: ProjectRepository,
        private readonly previewSnapshotRepository: PreviewSnapshotRepository,
        private readonly createPreviewSnapshot: CreatePreviewSnapshot,
    ) { }

    async execute(input: {
        projectId: string;
        userId: string;
        /** Already validated against `createPreviewSnapshotSchema`. */
        request: CreatePreviewSnapshotInput;
    }): Promise<CommitArtifactVersionResult> {
        const { projectId, userId, request: body } = input;

        const conversation = await this.conversationRepository.findById(body.conversationId, projectId);
        if (!conversation) {
            throw new HttpError("Conversation not found", {
                statusCode: 404,
                code: "CONVERSATION_NOT_FOUND",
                userMessage: "Conversation not found",
            });
        }

        // If rawLlmResponse is provided, let the backend be the authority on parsing.
        // Re-parse and override artifacts + structuredParseValid if the parse succeeds.
        // IMPORTANT: only override when the raw response contains non-empty html.
        // In focused-patch mode the LLM emits artifacts.html="" (only focusPatch
        // is populated); the server already merged the patch and returned the full
        // HTML to the client, which passes it back here as body.artifacts.html.
        // Overriding with empty html would corrupt the stored snapshot.
        let artifacts = body.artifacts;
        let structuredParseValid = body.metadata?.structuredParseValid ?? false;

        if (body.rawLlmResponse && !artifacts.html.trim()) {
            const parsed = tryParseStructuredJson(body.rawLlmResponse);
            if (parsed.parseValid && parsed.structured && parsed.structured.artifacts.html) {
                artifacts = {
                    html: parsed.structured.artifacts.html,
                    css: parsed.structured.artifacts.css,
                    js: parsed.structured.artifacts.js,
                };
                structuredParseValid = true;
            }
        }

        // Normalise then inject stable IDs before storing.
        // normalizeStoredHtml removes comments, collapses blank lines, and strips
        // empty style= attributes — typically saves 10–17% on LLM output.
        // repairArtifactsForVisibility patches the highest-impact recurrent
        // failure modes (orphan AOS, CSS literal escapes, Phaser parent on
        // <canvas>) so the preview is never blank because of a known bug.
        // injectStableIds tags every block element with data-pf-id for focused edits.
        if (artifacts.html) {
            const repaired = repairArtifactsForVisibility({
                html: artifacts.html,
                css: artifacts.css ?? "",
                js: artifacts.js ?? "",
            });
            if (repaired.repairs.length > 0) {
                ExecutionLogger.instance.emit({
                    projectId,
                    conversationId: body.conversationId,
                    domain: "snapshot",
                    eventType: "artifact_repaired",
                    level: "info",
                    status: "success",
                    metadata: { repairs: repaired.repairs },
                });
            }
            artifacts = {
                html: injectStableIds(normalizeStoredHtml(repaired.html)),
                css: repaired.css,
                js: repaired.js,
            };
        }

        const project = await this.projectRepository.findByIdForUser(projectId, userId);
        const inheritedManifest = body.parentSnapshotId
            ? (await this.previewSnapshotRepository.findById(projectId, body.parentSnapshotId))?.serviceManifest
            : undefined;
        // Validate and prepare the response/thumbnail view, but persist only canonical LLM
        // artifacts. Runtime settings can then change without regenerating or mutating the
        // immutable snapshot.
        if (body.activate) assertGeneratedJavaScriptSyntax(artifacts.js);
        const compiledForms = prepareArtifactServices({
            artifacts,
            serviceManifest: body.serviceManifest ?? inheritedManifest,
            formSettings: project?.serviceConfig?.forms,
            delivery: "inline-preview",
        });
        const runtimeArtifacts = compiledForms.artifacts;

        const { snapshot, created, baseVerification } = await this.createPreviewSnapshot.execute({
            projectId,
            conversationId: body.conversationId,
            sourceMessageId: body.sourceMessageId,
            parentSnapshotId: body.parentSnapshotId,
            // AL-040 — forwarded verbatim; the use case is where the claim is checked.
            baseContentHash: body.baseContentHash,
            artifacts,
            serviceManifest: body.serviceManifest,
            focusContext: body.focusContext,
            metadata: body.metadata ? { ...body.metadata, structuredParseValid } : undefined,
            activate: body.activate,
        });

        // ── Execution log (fire-and-forget) ──────────────────────────
        if (baseVerification === "unverifiable") {
            // AL-041 — accepted without certification because the base predates AL-039. Rare and
            // shrinking, but the one case where the guarantee does not hold, so it has to be
            // findable rather than silent.
            ExecutionLogger.instance.emit({
                projectId,
                conversationId: body.conversationId,
                snapshotId: body.parentSnapshotId,
                domain: "snapshot",
                eventType: "artifact_base_unverifiable",
                level: "warn",
                status: "success",
                metadata: {
                    baseSnapshotId: body.parentSnapshotId,
                    declaredContentHash: body.baseContentHash,
                    reason: "base carries no stored contentHash",
                },
            });
        }
        ExecutionLogger.instance.emit({
            projectId,
            conversationId: body.conversationId,
            snapshotId: snapshot.id,
            domain: "snapshot",
            eventType: created ? "snapshot_created" : "snapshot_noop_skipped",
            level: "info",
            status: "success",
            metadata: {
                snapshotId: snapshot.id,
                parentSnapshotId: body.parentSnapshotId,
                sourceMessageId: body.sourceMessageId,
                activated: body.activate,
                // AL-045 — false means the base was returned unchanged, no version added.
                created,
                contentHash: snapshot.metadata?.contentHash,
                htmlBytes: artifacts.html?.length ?? 0,
                finishReason: body.metadata?.finishReason,
                model: body.metadata?.model,
                provider: body.metadata?.provider,
                structuredParseValid,
                hasFocusContext: Boolean(body.focusContext),
                mediaResolutionTraceIds: snapshot.metadata?.mediaResolution?.traceIds,
                mediaResolutionAssetIds: snapshot.metadata?.mediaResolution?.assetIds,
                mediaResolutionMediaKeys: snapshot.metadata?.mediaResolution?.mediaKeys,
                mediaResolutionDegraded: snapshot.metadata?.mediaResolution?.degraded,
                mediaResolutionResolvedCount: snapshot.metadata?.mediaResolution?.directives?.filter(
                    (directive) => directive.status === "resolved" || directive.status === "fallback_resolved",
                ).length ?? snapshot.metadata?.mediaResolution?.assetIds?.length ?? 0,
                mediaResolutionFailedCount: snapshot.metadata?.mediaResolution?.directives?.filter(
                    (directive) => directive.status === "unresolved",
                ).length ?? 0,
            },
        });
        // ── end execution log ─────────────────────────────────────────

        // ── Background thumbnail job (fire-and-forget) ────────────────
        if (body.activate && runtimeArtifacts.html && (created || !snapshot.thumbnailPath)) {
            SnapshotThumbnailJob.schedule(
                projectId,
                snapshot.id,
                runtimeArtifacts,
                this.previewSnapshotRepository,
            );
        }
        // ── end thumbnail job ─────────────────────────────────────────

        return {
            created,
            snapshot: created
                ? { ...snapshot, artifacts: runtimeArtifacts, runtimePlan: compiledForms.runtimePlan }
                : withConfiguredFormRuntime(snapshot, project?.serviceConfig?.forms),
        };
    }
}
