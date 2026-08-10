import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";

/**
 * Optimistic concurrency guard shared by every use-case that can create-and-activate a
 * PreviewSnapshot (CreatePreviewSnapshot, CommitWysiwygSession). Scope is PROJECT-wide
 * because MongoPreviewSnapshotRepository.create()/activate() clear isActive across the
 * whole project, not just the current conversation — a guard scoped to the conversation
 * would miss cross-conversation clobbering.
 *
 * See docs/specs/PREVIEW_SNAPSHOT_CONCURRENCY_GUARD_PLAN.md for the full rationale.
 */
export async function assertActiveSnapshotPrecondition(
    previewSnapshotRepository: Pick<PreviewSnapshotRepository, "getActiveForProject">,
    projectId: string,
    expectedActiveSnapshotId: string | null | undefined,
): Promise<void> {
    if (expectedActiveSnapshotId === undefined) return;

    const currentActive = await previewSnapshotRepository.getActiveForProject(projectId);
    const actualActiveSnapshotId = currentActive?.id ?? null;
    const expected = expectedActiveSnapshotId ?? null;

    if (actualActiveSnapshotId !== expected) {
        throw Object.assign(
            new Error(
                `Active preview snapshot changed: expected "${expected ?? "none"}", found "${actualActiveSnapshotId ?? "none"}"`,
            ),
            {
                statusCode: 409,
                code: "PREVIEW_SNAPSHOT_ACTIVE_VERSION_CONFLICT",
                userMessage: "La versione attiva del progetto è cambiata mentre stavi lavorando.",
                details: { expectedActiveSnapshotId: expected, actualActiveSnapshotId },
            },
        );
    }
}
