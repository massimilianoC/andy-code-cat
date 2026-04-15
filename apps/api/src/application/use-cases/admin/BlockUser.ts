import { blockUserSchema } from "@andy-code-cat/contracts";
import type { SessionRepository } from "../../../domain/repositories/SessionRepository";
import type { UserRepository } from "../../../domain/repositories/UserRepository";

export class BlockUser {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly sessionRepository: SessionRepository,
    ) { }

    async execute(targetUserId: string, callerUserId: string, rawInput: unknown) {
        if (targetUserId === callerUserId) {
            throw Object.assign(new Error("Cannot block your own account"), { statusCode: 400 });
        }

        const { blocked } = blockUserSchema.parse(rawInput);

        const user = await this.userRepository.findById(targetUserId);
        if (!user) {
            throw Object.assign(new Error("User not found"), { statusCode: 404 });
        }

        // Prevent blocking another superadmin
        if (user.roles.includes("superadmin")) {
            throw Object.assign(new Error("Cannot block a superadmin account"), { statusCode: 403 });
        }

        await this.userRepository.setBlocked(targetUserId, blocked);

        if (blocked) {
            await this.sessionRepository.deleteAllByUserId(targetUserId);
        }

        return { userId: targetUserId, isBlocked: blocked };
    }
}
