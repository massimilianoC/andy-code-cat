import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config", () => ({
    env: {
        JWT_ACCESS_SECRET: "test-access-secret-0123456789",
        JWT_REFRESH_SECRET: "test-refresh-secret-0123456789",
        JWT_ACCESS_TTL: "2h",
        JWT_REFRESH_TTL: "30d",
        LLM_DEFAULT_PROVIDER: "openrouter",
        authBypassEmailVerification: true,
    },
}));

import { RegisterUser } from "../RegisterUser";
import { LoginUser } from "../LoginUser";
import type { UserRepository } from "../../../domain/repositories/UserRepository";
import type { ProjectRepository } from "../../../domain/repositories/ProjectRepository";
import type { SessionRepository } from "../../../domain/repositories/SessionRepository";
import { hashPassword } from "../../../infra/security/password";

const PASSWORD = "Str0ng!Passw0rd#2026";

/**
 * A new account starts on the dashboard with no project: the first one comes from Vibe or from
 * a template. Neither registration nor login may create a placeholder project, and a login must
 * succeed for an account that owns none.
 */
describe("an account without a default project", () => {
    it("registration creates the user and no project", async () => {
        const create = vi.fn(async (input: { email: string }) => ({
            id: "u1",
            email: input.email,
            emailVerified: true,
        }));
        const userRepository = {
            findByEmail: vi.fn(async () => null),
            create,
        } as unknown as UserRepository;

        const result = await new RegisterUser(userRepository).execute({ email: "new@example.com", password: PASSWORD });

        expect(create).toHaveBeenCalledTimes(1);
        expect(result.user.email).toBe("new@example.com");
        expect(result).not.toHaveProperty("defaultProject");
    });

    it("login with zero projects succeeds, creates nothing, and binds the session to no project", async () => {
        const userRepository = {
            findByEmail: vi.fn(async () => ({
                id: "507f1f77bcf86cd799439011",
                email: "new@example.com",
                passwordHash: await hashPassword(PASSWORD),
                emailVerified: true,
                roles: ["user"],
                passwordPolicyVersion: 99,
            })),
        } as unknown as UserRepository;
        const projectCreate = vi.fn();
        const projectRepository = {
            listForUser: vi.fn(async () => []),
            create: projectCreate,
        } as unknown as ProjectRepository;
        const sessionCreate = vi.fn(async (input: Record<string, unknown>) => ({ id: "s1", ...input }));
        const sessionRepository = { create: sessionCreate } as unknown as SessionRepository;

        const result = await new LoginUser(userRepository, projectRepository, sessionRepository)
            .execute({ email: "new@example.com", password: PASSWORD });

        expect(projectCreate).not.toHaveBeenCalled();
        expect(result.projects).toEqual([]);
        expect(result).not.toHaveProperty("activeProjectId");
        expect(result.accessToken).toBeTruthy();
        expect(sessionCreate).toHaveBeenCalledTimes(1);
        expect(sessionCreate.mock.calls[0]![0]).not.toHaveProperty("projectId");
    });
});
