import type { UserRepository } from "../../../domain/repositories/UserRepository";
import type { ProjectRepository } from "../../../domain/repositories/ProjectRepository";
import type { SessionRepository } from "../../../domain/repositories/SessionRepository";
import type { ProjectAssetRepository } from "../../../domain/repositories/ProjectAssetRepository";
import type { BrandAssetRepository } from "../../../domain/repositories/BrandAssetRepository";
import type { UserTemplateRepository } from "../../../domain/repositories/UserTemplateRepository";
import type { UserPreferencesRepository } from "../../../domain/repositories/UserPreferencesRepository";
import type { UserStyleProfileRepository } from "../../../domain/repositories/UserStyleProfileRepository";
import type { SystemNotificationRepository } from "../../../domain/repositories/SystemNotificationRepository";
import type { ExportRepository } from "../../../domain/repositories/ExportRepository";
import type { BackgroundRunRepository } from "../../../domain/repositories/BackgroundRunRepository";
import type { ServiceApiKeyRepository } from "../../../domain/repositories/ServiceApiKeyRepository";
import type { IFileStorage } from "../../../infra/storage/IFileStorage";
import type { DeleteProject } from "../DeleteProject";

export interface DeleteUserDependencies {
    users: UserRepository;
    projects: ProjectRepository;
    deleteProject: DeleteProject;
    sessions: SessionRepository;
    projectAssets: ProjectAssetRepository;
    brandAssets: BrandAssetRepository;
    templates: UserTemplateRepository;
    preferences: UserPreferencesRepository;
    styleProfiles: UserStyleProfileRepository;
    notifications: SystemNotificationRepository;
    exports: ExportRepository;
    backgroundRuns: BackgroundRunRepository;
    serviceApiKeys: ServiceApiKeyRepository;
    fileStorage: IFileStorage;
}

/** One or more account-level steps failed: the account row is kept, blocked, and can be deleted again. */
export class AccountDeletionIncompleteError extends Error {
    readonly statusCode = 500;
    readonly code = "ACCOUNT_DELETE_INCOMPLETE";
    readonly userMessage = "La cancellazione dell'account non è stata completata. L'account è bloccato e conservato: riprova.";
    readonly details: { userId: string; failedSteps: string[] };

    constructor(userId: string, failedSteps: string[]) {
        super(`Account deletion incomplete; failed steps: ${failedSteps.join(", ")}`);
        this.name = "AccountDeletionIncompleteError";
        this.details = { userId, failedSteps };
    }
}

/**
 * Deleting an account deletes what the account owns.
 *
 * 1. The account is blocked and its sessions revoked, so nothing new is written while it is
 *    being removed and its published sites stop being served.
 * 2. Every project goes through `DeleteProject` — the one project deletion, with its files,
 *    published directories and visitor data. A project that cannot be deleted stops the account
 *    deletion there.
 * 3. Account-level files, then account-level records: library and brand assets, templates,
 *    preferences, style profile, notifications, exports, background runs, service keys.
 * 4. The account row, last and only when everything before it succeeded. Until then the account
 *    stays, blocked, and the deletion can be repeated: every step is idempotent.
 *
 * Kept on purpose: the superadmin audit log (`admin_audit_logs`) and the TTL-bound
 * `execution_logs`, which exist to outlive the actions they record.
 */
export class DeleteUser {
    constructor(private readonly deps: DeleteUserDependencies) {}

    async execute(targetUserId: string, callerUserId: string) {
        const d = this.deps;
        if (targetUserId === callerUserId) {
            throw Object.assign(new Error("Cannot delete your own account"), { statusCode: 400 });
        }

        const user = await d.users.findById(targetUserId);
        if (!user) {
            throw Object.assign(new Error("User not found"), { statusCode: 404 });
        }

        if (user.roles.includes("superadmin")) {
            throw Object.assign(new Error("Cannot delete a superadmin account"), { statusCode: 403 });
        }

        await d.users.setBlocked(targetUserId, true);
        await d.sessions.deleteAllByUserId(targetUserId);

        const projects = await d.projects.listForUser(targetUserId);
        for (const project of projects) {
            await d.deleteProject.execute(project.id, targetUserId);
        }

        await this.runAll(targetUserId, [
            ["account files", () => d.fileStorage.deleteUserFiles(targetUserId)],
        ]);
        await this.runAll(targetUserId, [
            ["library assets", () => d.projectAssets.deleteByUser(targetUserId)],
            ["brand assets", () => d.brandAssets.deleteByUser(targetUserId)],
            ["templates", () => d.templates.deleteByOwner(targetUserId)],
            ["preferences", () => d.preferences.deleteByUserId(targetUserId)],
            ["style profile", () => d.styleProfiles.deleteByUserId(targetUserId)],
            ["notifications", () => d.notifications.deleteByUser(targetUserId)],
            ["exports", () => d.exports.deleteByUser(targetUserId)],
            ["background runs", () => d.backgroundRuns.deleteByUser(targetUserId)],
            ["service keys", () => d.serviceApiKeys.deleteByUser(targetUserId)],
            // Again at the end: a refresh that raced the first revocation leaves no session behind.
            ["sessions", () => d.sessions.deleteAllByUserId(targetUserId)],
        ]);

        await d.users.deleteById(targetUserId);
        return { deleted: true, userId: targetUserId, projectsDeleted: projects.length };
    }

    private async runAll(userId: string, steps: ReadonlyArray<readonly [string, () => Promise<unknown>]>): Promise<void> {
        const results = await Promise.allSettled(steps.map(([, run]) => run()));
        const failed = results.flatMap((result, index) => result.status === "rejected" ? [steps[index]![0]] : []);
        if (failed.length === 0) return;
        console.error("[DeleteUser] account deletion incomplete; account kept and blocked", {
            userId,
            failedSteps: failed,
            errors: results.flatMap((result) => result.status === "rejected"
                ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
                : []),
        });
        throw new AccountDeletionIncompleteError(userId, failed);
    }
}
