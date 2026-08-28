import { describe, expect, it } from "vitest";
import { buildVersionIndex, type VersionChainNode } from "../versionNumbering";

function snap(id: string, createdAt: string, parentSnapshotId?: string): VersionChainNode {
    return { id, createdAt, parentSnapshotId };
}

describe("buildVersionIndex — AL-011", () => {
    it("numbers a linear chain v1..vN by seed depth", () => {
        const snapshots = [
            snap("s1", "2026-01-01T00:00:00Z"),
            snap("s2", "2026-01-01T00:01:00Z", "s1"),
            snap("s3", "2026-01-01T00:02:00Z", "s2"),
            snap("s4", "2026-01-01T00:03:00Z", "s3"),
        ];

        const index = buildVersionIndex(snapshots);

        expect(index.get("s1")).toBe(1);
        expect(index.get("s2")).toBe(2);
        expect(index.get("s3")).toBe(3);
        expect(index.get("s4")).toBe(4);
    });

    it("numbers each path of a branched chain by its own depth, independent of list position", () => {
        // s1 -> s2 -> s3
        //        \-> s4  (user went back to s2 and edited again)
        const snapshots = [
            snap("s1", "2026-01-01T00:00:00Z"),
            snap("s2", "2026-01-01T00:01:00Z", "s1"),
            snap("s3", "2026-01-01T00:02:00Z", "s2"),
            snap("s4", "2026-01-01T00:03:00Z", "s2"),
        ];

        const index = buildVersionIndex(snapshots);

        expect(index.get("s1")).toBe(1);
        expect(index.get("s2")).toBe(2);
        // Both branches descend from s2 at depth 2, so both land at depth 3 — same version
        // number on two different branches is correct, not a collision, once branching exists.
        expect(index.get("s3")).toBe(3);
        expect(index.get("s4")).toBe(3);
    });

    it("numbers a legacy all-roots project sequentially by creation time", () => {
        // Pre-enforcement data: every snapshot was written with parentSnapshotId: null.
        const snapshots = [
            snap("legacy1", "2026-01-01T00:00:00Z"),
            snap("legacy2", "2026-01-01T00:01:00Z"),
            snap("legacy3", "2026-01-01T00:02:00Z"),
        ];

        const index = buildVersionIndex(snapshots);

        expect(index.get("legacy1")).toBe(1);
        expect(index.get("legacy2")).toBe(2);
        expect(index.get("legacy3")).toBe(3);
    });

    it("numbers a single version v1", () => {
        const index = buildVersionIndex([snap("only", "2026-01-01T00:00:00Z")]);
        expect(index.get("only")).toBe(1);
        expect(index.size).toBe(1);
    });

    it("returns an empty map for empty input", () => {
        const index = buildVersionIndex([]);
        expect(index.size).toBe(0);
    });

    it("treats a parentSnapshotId pointing outside the given set as a legacy root, not a crash", () => {
        const snapshots = [
            snap("s1", "2026-01-01T00:00:00Z"),
            // Parent "deleted-and-gone" is not present in this array (e.g. deleted elsewhere).
            snap("s2", "2026-01-01T00:01:00Z", "deleted-and-gone"),
        ];

        const index = buildVersionIndex(snapshots);

        expect(index.get("s1")).toBe(1);
        expect(index.get("s2")).toBe(2);
    });
});
