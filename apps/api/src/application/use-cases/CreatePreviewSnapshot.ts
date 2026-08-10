import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";
import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { MediaResolutionTraceRepository } from "../../domain/repositories/MediaResolutionTraceRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import { extractMediaPlaceholderKeys } from "../media/replaceMediaPlaceholders";
import { assertActiveSnapshotPrecondition } from "./assertActiveSnapshotPrecondition";

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
        artifacts: PreviewSnapshot["artifacts"];
        serviceManifest?: PreviewSnapshot["serviceManifest"];
        focusContext?: PreviewSnapshot["focusContext"];
        metadata?: PreviewSnapshot["metadata"];
        activate: boolean;
        /** Optimistic concurrency precondition — see assertActiveSnapshotPrecondition.ts. */
        expectedActiveSnapshotId?: string | null;
    }): Promise<PreviewSnapshot> {
        if (input.activate) {
            const unresolvedKeys = extractMediaPlaceholderKeys(input.artifacts);
            if (unresolvedKeys.length > 0) {
                const err = new Error(`Cannot activate preview snapshot with unresolved media placeholders: ${unresolvedKeys.join(", ")}`);
                (err as NodeJS.ErrnoException & { status: number }).status = 400;
                throw err;
            }
            await assertActiveSnapshotPrecondition(this.previewSnapshotRepository, input.projectId, input.expectedActiveSnapshotId);
        }

        if (input.sourceMessageId && this.conversationRepository) {
            const conversation = await this.conversationRepository.findById(input.conversationId, input.projectId);
            const sourceMessageExists = conversation?.messages.some((message) => message.id === input.sourceMessageId);
            if (!sourceMessageExists) {
                const err = new Error(`Source message "${input.sourceMessageId}" not found in conversation "${input.conversationId}"`);
                (err as NodeJS.ErrnoException & { status: number }).status = 404;
                throw err;
            }
        }

        const parentSnapshot = input.parentSnapshotId
            ? await this.previewSnapshotRepository.findById(input.projectId, input.parentSnapshotId)
            : null;
        const snapshot = await this.previewSnapshotRepository.create({
            ...input,
            // Focused edits and WYSIWYG commits do not regenerate a manifest. Preserve the
            // explicitly selected parent definition rather than silently dropping forms.
            serviceManifest: input.serviceManifest ?? parentSnapshot?.serviceManifest,
        });
        const traceIds = input.metadata?.mediaResolution?.traceIds ?? [];
        if (traceIds.length > 0) {
            await this.mediaTraceRepository?.attachSnapshot(input.projectId, traceIds, snapshot.id);
        }

        if (input.sourceMessageId && this.conversationRepository) {
            await this.conversationRepository.updateMessageMetadata(
                input.conversationId,
                input.projectId,
                input.sourceMessageId,
                {
                    snapshotId: snapshot.id,
                    mediaResolution: input.metadata?.mediaResolution,
                },
            );
        }

        return snapshot;
    }
}
