import { describe, it, expect, vi } from "vitest";
import { ProjectDataRegistry } from "../ProjectDataRegistry";
import { ManageProjectData } from "../ManageProjectData";
import type { ProjectDataCapability, ProjectDataGroupSummary, ProjectDataRecord } from "../../../domain/projectData/ProjectDataCapability";

const scope = { ownerUserId: "u1", projectId: "p1" };

function capability(id: string, over: Partial<ProjectDataCapability> = {}): ProjectDataCapability {
    return {
        id,
        label: id.toUpperCase(),
        groups: vi.fn(async (): Promise<ProjectDataGroupSummary[]> => []),
        list: vi.fn(async () => ({ items: [], total: 0 })),
        exportRecords: vi.fn(async (): Promise<ProjectDataRecord[]> => []),
        deleteRecord: vi.fn(async () => false),
        clear: vi.fn(async () => 0),
        ...over,
    };
}

describe("ProjectDataRegistry", () => {
    it("refuses two capabilities with the same id", () => {
        expect(() => new ProjectDataRegistry([capability("leaderboard"), capability("leaderboard")])).toThrow(/Duplicate/);
    });

    it("resolves capabilities by id only", () => {
        const leaderboard = capability("leaderboard");
        const registry = new ProjectDataRegistry([leaderboard]);
        expect(registry.get("leaderboard")).toBe(leaderboard);
        expect(registry.get("forms")).toBeUndefined();
        expect(registry.get("__proto__")).toBeUndefined();
    });

    it("purges every capability of the project with the whole scope and reports per capability", async () => {
        const leaderboard = capability("leaderboard", { clear: vi.fn(async () => 3) });
        const forms = capability("forms", { clear: vi.fn(async () => 2) });
        const removed = await new ProjectDataRegistry([leaderboard, forms]).purgeProject(scope);
        expect(removed).toEqual({ leaderboard: 3, forms: 2 });
        expect(leaderboard.clear).toHaveBeenCalledWith(scope);
        expect(forms.clear).toHaveBeenCalledWith(scope);
    });
});

describe("ManageProjectData", () => {
    const t1 = new Date("2026-11-20T00:00:00.000Z");
    const t2 = new Date("2026-11-24T00:00:00.000Z");

    it("summarises every capability, including one with no records", async () => {
        const leaderboard = capability("leaderboard", {
            groups: vi.fn(async () => [
                { id: "default", label: "default", records: 2, lastWriteAt: t1 },
                { id: "speedrun", label: "speedrun", records: 1, lastWriteAt: t2 },
            ]),
        });
        const summary = await new ManageProjectData(new ProjectDataRegistry([leaderboard, capability("forms")])).summary(scope);
        expect(summary.capabilities).toEqual([
            {
                id: "leaderboard",
                label: "LEADERBOARD",
                records: 3,
                lastWriteAt: t2.toISOString(),
                groups: [
                    { id: "default", label: "default", records: 2, lastWriteAt: t1.toISOString() },
                    { id: "speedrun", label: "speedrun", records: 1, lastWriteAt: t2.toISOString() },
                ],
            },
            { id: "forms", label: "FORMS", records: 0, groups: [] },
        ]);
    });

    it("answers 404 for an unknown capability and 400 for a wrong confirmation, before touching data", async () => {
        const leaderboard = capability("leaderboard");
        const manage = new ManageProjectData(new ProjectDataRegistry([leaderboard]));
        await expect(manage.clear(scope, "nope", { confirm: "nope" })).rejects.toMatchObject({ statusCode: 404 });
        await expect(manage.clear(scope, "leaderboard", { confirm: "Leaderboard" })).rejects.toMatchObject({ statusCode: 400, code: "PROJECT_DATA_CONFIRMATION_MISMATCH" });
        expect(leaderboard.clear).not.toHaveBeenCalled();
    });

    it("names the export file safely and reports truncation against the group's total", async () => {
        const leaderboard = capability("leaderboard", {
            groups: vi.fn(async () => [{ id: "a:b", label: "a:b", records: 5 }, { id: "other", label: "other", records: 9 }]),
            exportRecords: vi.fn(async () => [{ id: "r1", groupId: "a:b", createdAt: t1, data: { x: 1 } }]),
        });
        const manage = new ManageProjectData(new ProjectDataRegistry([leaderboard]));
        const file = await manage.exportFile(scope, "leaderboard", { groupId: "a:b", format: "json" }, new Date("2026-11-25T10:11:12.000Z"));
        expect(file.filename).toBe("project-data-leaderboard-a_b-20261125-101112.json");
        expect(file.total).toBe(5);
        const body = JSON.parse(file.body);
        expect(body).toMatchObject({ capability: "leaderboard", groupId: "a:b", total: 5, truncated: true });
        expect(body.records).toEqual([{ id: "r1", groupId: "a:b", createdAt: t1.toISOString(), data: { x: 1 } }]);
    });
});
