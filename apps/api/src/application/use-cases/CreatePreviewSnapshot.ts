import { ARTIFACT_BASE_STALE } from "@andy-code-cat/contracts";
import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";
import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { MediaResolutionTraceRepository } from "../../domain/repositories/MediaResolutionTraceRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import { HttpError } from "../../presentation/http/errors/httpError";
import { computeArtifactContentHash } from "../artifacts/artifactContentHash";
import { extractMediaPlaceholderKeys } from "../media/replaceMediaPlaceholders";

export interface CreatePreviewSnapshotResult {
    snapshot: PreviewSnapshot;
    /**
     * AL-045 — false when the write produced no new version because its content was
     * byte-identical to its base. The caller gets the base back, so the id it reports is a
     * real, current version either way; this flag only says whether history moved.
     */
    created: boolean;
    /**
     * AL-041 — what happened to the base the client declared. "unverifiable" is the case
     * worth surfacing: the write was accepted without certification because its base predates
     * AL-039. Reported rather than logged here so the application layer stays free of infra.
     */
    baseVerification: "none" | "verified" | "unverifiable";
}

export class CreatePreviewSnapshot {
    constructor(
        private readonly previewSnapshotRepository: PreviewSnapshotRepository,
        private readonly mediaTraceRepository?: MediaResolutionTraceRepository,
        private readonly conversationRepository?: ConversationRepository,
    ) { }

    async execute(input: {
        projectId: string;
        conversationId: string;
        sourceMessageId?: string;
        parentSnapshotId?: string;
        /** AL-040 — the contentHash the client says its base had when it loaded it. */
        baseContentHash?: string;
        artifacts: PreviewSnapshot["artifacts"];
        serviceManifest?: PreviewSnapshot["serviceManifest"];
        focusContext?: PreviewSnapshot["focusContext"];
        metadata?: PreviewSnapshot["metadata"];
        activate: boolean;
    }): Promise<CreatePreviewSnapshotResult> {
        if (input.activate) {
            const unresolvedKeys = extractMediaPlaceholderKeys(input.artifacts);
            if (unresolvedKeys.length > 0) {
                throw new HttpError(
                    `Cannot activate preview snapshot with unresolved media placeholders: ${unresolvedKeys.join(", ")}`,
                    { statusCode: 400, code: "UNRESOLVED_MEDIA_PLACEHOLDERS", details: { unresolvedKeys } },
                );
            }
        }

        if (input.sourceMessageId && this.conversationRepository) {
            const conversation = await this.conversationRepository.findById(input.conversationId, input.projectId);
            const sourceMessageExists = conversation?.messages.some((message) => message.id === input.sourceMessageId);
            if (!sourceMessageExists) {
                throw new HttpError(
                    `Source message "${input.sourceMessageId}" not found in conversation "${input.conversationId}"`,
                    { statusCode: 404, code: "SOURCE_MESSAGE_NOT_FOUND" },
                );
            }
        }

        // The version chain is a server invariant, not something every caller has to remember.
        // A snapshot created without an explicit parent continues from whatever is active — that
        // is what "save this as a new version" means. Three client call sites (the Monaco save,
        // the WYSIWYG degraded commit, the focused-edit fallback) omitted the parent and each
        // silently started a second root, which is what made the history look like a single v1
        // that kept being overwritten.
        const parentSnapshotId = input.parentSnapshotId
            ?? (await this.previewSnapshotRepository.getActiveForProject(input.projectId))?.id;
        const parentSnapshot = parentSnapshotId
            ? await this.previewSnapshotRepository.findById(input.projectId, parentSnapshotId)
            : null;

        const baseVerification = this.verifyDeclaredBase(input, parentSnapshot);

        // AL-039 — computed here, over the artifacts as they will be stored, and never taken
        // from the request: a hash the writer chooses certifies nothing.
        const contentHash = computeArtifactContentHash(input.artifacts);

        // AL-045 — an edit that changed nothing is not a version. The base's own hash is
        // computed on the fly when it predates AL-039, so this also collapses the identical
        // saves already sitting in history rather than only guarding new ones.
        if (parentSnapshot) {
            const parentHash = parentSnapshot.metadata?.contentHash
                ?? computeArtifactContentHash(parentSnapshot.artifacts);
            if (parentHash === contentHash) {
                return {
                    snapshot: await this.returnBaseUnchanged(input, parentSnapshot),
                    created: false,
                    baseVerification,
                };
            }
        }

        const snapshot = await this.previewSnapshotRepository.create({
            ...input,
            // Never parent a snapshot to itself, and never invent a parent that no longer exists.
            parentSnapshotId: parentSnapshot?.id,
            // Focused edits and WYSIWYG commits do not regenerate a manifest. Preserve the
            // explicitly selected parent definition rather than silently dropping forms.
            serviceManifest: input.serviceManifest ?? parentSnapshot?.serviceManifest,
            metadata: { ...input.metadata, contentHash },
        });
        const traceIds = input.metadata?.mediaResolution?.traceIds ?? [];
        if (traceIds.length > 0) {
            await this.mediaTraceRepository?.attachSnapshot(input.projectId, traceIds, snapshot.id);
        }

        await this.linkSourceMessage(input, snapshot.id);

        return { snapshot, created: true, baseVerification };
    }

    /**
     * AL-041 — a write that declares a base is accepted only if that base is still there and
     * still hashes to what the client says it saw. This is the guarantee that an editor can
     * never overwrite a version it never read: a stale tab, a lost response, a second window
     * that already advanced the chain all produce a mismatch and are refused, and the refusal
     * names the version the server believes is current so the client can re-synchronise.
     *
     * A write that declares nothing is accepted as before — the chain holds versions stored
     * long before this rule existed, and locking their owners out of them is the larger harm.
     */
    private verifyDeclaredBase(
        input: { baseContentHash?: string; parentSnapshotId?: string },
        parentSnapshot: PreviewSnapshot | null,
    ): "none" | "verified" | "unverifiable" {
        if (!input.baseContentHash) return "none";

        if (!parentSnapshot) {
            throw new HttpError(
                "The artifact version this edit was based on no longer exists.",
                {
                    statusCode: 409,
                    code: ARTIFACT_BASE_STALE,
                    userMessage: "La versione da cui parte questa modifica non esiste piu. Ricarica lo storico e riprova.",
                    details: {
                        declaredSnapshotId: input.parentSnapshotId,
                        declaredContentHash: input.baseContentHash,
                        currentSnapshotId: null,
                    },
                },
            );
        }

        const storedHash = parentSnapshot.metadata?.contentHash;
        if (!storedHash) {
            // Pre-AL-039 version: there is nothing to compare against. Accept rather than
            // strand the user in their own history, but report it — an unverifiable write is
            // exactly the event worth being able to find later.
            return "unverifiable";
        }

        if (storedHash !== input.baseContentHash) {
            throw new HttpError(
                `Declared base ${parentSnapshot.id} hashes to ${storedHash}, not the ${input.baseContentHash} this edit was built on.`,
                {
                    statusCode: 409,
                    code: ARTIFACT_BASE_STALE,
                    userMessage: "Questa modifica parte da una versione che nel frattempo e cambiata. Ricarica la versione corrente e riapplica la modifica.",
                    details: {
                        declaredSnapshotId: input.parentSnapshotId ?? parentSnapshot.id,
                        declaredContentHash: input.baseContentHash,
                        currentSnapshotId: parentSnapshot.id,
                        currentContentHash: storedHash,
                    },
                },
            );
        }

        return "verified";
    }

    /**
     * AL-045 — the write is a no-op, so history does not move. The base is still made active
     * when activation was asked for: "make this the live version" is a separate intent from
     * "record a new version", and refusing the first because the second was unnecessary would
     * leave the user looking at something they did not select.
     */
    private async returnBaseUnchanged(
        input: {
            projectId: string;
            conversationId: string;
            sourceMessageId?: string;
            metadata?: PreviewSnapshot["metadata"];
            activate: boolean;
        },
        parentSnapshot: PreviewSnapshot,
    ): Promise<PreviewSnapshot> {
        let snapshot = parentSnapshot;
        if (input.activate && !parentSnapshot.isActive) {
            snapshot = await this.previewSnapshotRepository.activateForProject(input.projectId, parentSnapshot.id)
                ?? parentSnapshot;
        }

        await this.linkSourceMessage(input, snapshot.id);
        return snapshot;
    }

    private async linkSourceMessage(
        input: {
            projectId: string;
            conversationId: string;
            sourceMessageId?: string;
            metadata?: PreviewSnapshot["metadata"];
        },
        snapshotId: string,
    ): Promise<void> {
        if (!input.sourceMessageId || !this.conversationRepository) return;
        await this.conversationRepository.updateMessageMetadata(
            input.conversationId,
            input.projectId,
            input.sourceMessageId,
            {
                snapshotId,
                mediaResolution: input.metadata?.mediaResolution,
            },
        );
    }
}
