export interface VersionChainNode {
    id: string;
    parentSnapshotId?: string;
    createdAt: string;
}

/**
 * AL-011 — version numbers must derive from the seed chain, never from list position.
 * `SnapshotHistoryPanel` used to compute `snapshots.length - i`, which misrepresents history
 * the moment a branch exists (AL-013) and renumbers every surviving version when one is
 * deleted (AL-015). This computes, for each snapshot, its depth along the
 * `parentSnapshotId` chain — the seed's number + 1 — which is stable under both.
 *
 * Legacy fallback (decided, display-only — see ARTIFACT_LIFECYCLE_EXECUTION_PLAN.md B2): 158
 * of 195 stored snapshots predate server-side seed enforcement (commit 227609f) and were
 * written as parent-less roots. Numbering all of them "v1" would be a worse regression than
 * the position-based bug this replaces, so a root that is not the project's earliest snapshot
 * is treated, for numbering only, as descending from the snapshot immediately before it by
 * `createdAt`. Nothing here is written back to the database — the stored chain still records
 * what actually happened (or didn't); only the displayed number is inferred.
 */
export function buildVersionIndex(snapshots: VersionChainNode[]): Map<string, number> {
    const result = new Map<string, number>();
    if (snapshots.length === 0) return result;

    const byId = new Map(snapshots.map((s) => [s.id, s]));
    const chronological = [...snapshots].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const earliestId = chronological[0].id;

    // Effective parent for numbering purposes: the real seed when it resolves within this set,
    // else — for every root except the very first snapshot the project ever had — the legacy
    // fallback described above.
    const effectiveParent = new Map<string, string | undefined>();
    chronological.forEach((snap, i) => {
        const declaredParent = snap.parentSnapshotId && byId.has(snap.parentSnapshotId)
            ? snap.parentSnapshotId
            : undefined;
        if (declaredParent) {
            effectiveParent.set(snap.id, declaredParent);
            return;
        }
        effectiveParent.set(snap.id, snap.id === earliestId ? undefined : chronological[i - 1].id);
    });

    // Depth = 1 for a root, seed's depth + 1 otherwise. `visiting` guards a pathological cycle
    // (should never occur — parents are only ever earlier in time) so it degrades to depth 1
    // instead of recursing forever.
    const visiting = new Set<string>();
    function depthOf(id: string): number {
        const cached = result.get(id);
        if (cached !== undefined) return cached;
        const parentId = effectiveParent.get(id);
        if (!parentId || visiting.has(id)) {
            result.set(id, 1);
            return 1;
        }
        visiting.add(id);
        const depth = depthOf(parentId) + 1;
        visiting.delete(id);
        result.set(id, depth);
        return depth;
    }

    for (const snap of chronological) depthOf(snap.id);
    return result;
}
