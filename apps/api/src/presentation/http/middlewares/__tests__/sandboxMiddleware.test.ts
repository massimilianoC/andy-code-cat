import { describe, expect, it, vi } from "vitest";
import type { ProjectRepository } from "../../../../domain/repositories/ProjectRepository";
import { createSandboxMiddleware } from "../sandboxMiddleware";
import type { RequestWithContext } from "../../types";

function run(projectId: string, repository: Partial<ProjectRepository>) {
    const middleware = createSandboxMiddleware(repository as ProjectRepository);
    const req = { auth: { userId: "64b000000000000000000001" }, headers: { "x-project-id": projectId } } as unknown as RequestWithContext;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();
    return { done: middleware(req, res as never, next), req, res, next };
}

describe("sandboxMiddleware", () => {
    it("refuses a malformed project id without reaching the database (the driver would throw)", async () => {
        const findByIdForUser = vi.fn();
        for (const bad of ["xyz", "64b00000000000000000000", "64b0000000000000000000011", "zzzzzzzzzzzzzzzzzzzzzzzz", "{\"$ne\":null}"]) {
            const { done, res, next } = run(bad, { findByIdForUser });
            await expect(done).resolves.toBeUndefined();
            expect(res.status, bad).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        }
        expect(findByIdForUser).not.toHaveBeenCalled();
    });

    it("passes repository failures to the error handler instead of rejecting", async () => {
        const failure = new Error("connection lost");
        const { done, next } = run("64b0000000000000000000aa", { findByIdForUser: vi.fn().mockRejectedValue(failure) });
        await expect(done).resolves.toBeUndefined();
        expect(next).toHaveBeenCalledWith(failure);
    });

    it("sets the sandbox for a project the caller owns", async () => {
        const { done, req, next } = run("64B0000000000000000000AA", { findByIdForUser: vi.fn().mockResolvedValue({ id: "64b0000000000000000000aa" }) });
        await done;
        expect(req.sandbox).toEqual({ projectId: "64b0000000000000000000aa" });
        expect(next).toHaveBeenCalledWith();
    });
});
