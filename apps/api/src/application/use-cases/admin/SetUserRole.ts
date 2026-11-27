import { setUserRolesSchema } from "@andy-code-cat/contracts";
import type { UserRepository } from "../../../domain/repositories/UserRepository";
import type { SessionRepository } from "../../../domain/repositories/SessionRepository";

/**
 * Changes an account's roles. They take effect on the next request (authMiddleware reads roles
 * from the account record); the account's sessions are revoked so it signs in again with tokens
 * that state the new roles.
 */
export class SetUserRole {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly sessionRepository: Pick<SessionRepository, "deleteAllByUserId">,
    ) {}

    async execute(targetUserId: string, callerUserId: string, rawInput: unknown) {
        if (targetUserId === callerUserId) {
            throw Object.assign(new Error("Cannot change your own roles"), { statusCode: 400 });
        }

        const { roles } = setUserRolesSchema.parse(rawInput);

        const user = await this.userRepository.findById(targetUserId);
        if (!user) {
            throw Object.assign(new Error("User not found"), { statusCode: 404 });
        }

        await this.userRepository.setRoles(targetUserId, roles as ("user" | "admin" | "superadmin")[]);
        await this.sessionRepository.deleteAllByUserId(targetUserId);
        return { userId: targetUserId, roles };
    }
}
