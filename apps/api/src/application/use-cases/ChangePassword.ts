import {
    changePasswordSchema,
    CURRENT_PASSWORD_POLICY_VERSION,
    type ChangePasswordInput
} from "@andy-code-cat/contracts";
import type { SessionRepository } from "../../domain/repositories/SessionRepository";
import type { UserRepository } from "../../domain/repositories/UserRepository";
import { hashPassword, verifyPassword } from "../../infra/security/password";

export class ChangePassword {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly sessionRepository: SessionRepository
    ) { }

    async execute(userId: string, rawInput: ChangePasswordInput) {
        const input = changePasswordSchema.parse(rawInput);
        const user = await this.userRepository.findById(userId);

        if (!user) {
            throw Object.assign(new Error("User not found"), { statusCode: 404 });
        }

        const isCurrentPasswordValid = await verifyPassword(input.currentPassword, user.passwordHash);
        if (!isCurrentPasswordValid) {
            throw Object.assign(new Error("Current password is incorrect"), { statusCode: 400 });
        }

        const updatedUser = await this.userRepository.updatePassword(
            userId,
            await hashPassword(input.newPassword),
            CURRENT_PASSWORD_POLICY_VERSION
        );

        if (!updatedUser) {
            throw Object.assign(new Error("Failed to update password"), { statusCode: 500 });
        }

        await this.sessionRepository.deleteAllByUserId(userId);

        return {
            reauthRequired: true,
            requiresPasswordChange: false,
        };
    }
}