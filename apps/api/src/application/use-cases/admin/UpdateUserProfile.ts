import { adminUpdateUserProfileSchema } from "@andy-code-cat/contracts";
import type { UserRepository } from "../../../domain/repositories/UserRepository";

export class UpdateUserProfile {
    constructor(private readonly userRepository: UserRepository) { }

    async execute(targetUserId: string, rawInput: unknown) {
        const input = adminUpdateUserProfileSchema.parse(rawInput);

        const user = await this.userRepository.findById(targetUserId);
        if (!user) {
            throw Object.assign(new Error("User not found"), { statusCode: 404 });
        }

        const normalizedEmail = input.email?.toLowerCase();
        if (normalizedEmail && normalizedEmail !== user.email) {
            const existing = await this.userRepository.findByEmail(normalizedEmail);
            if (existing && existing.id !== targetUserId) {
                throw Object.assign(new Error("Email already in use"), { statusCode: 409 });
            }
        }

        const updated = await this.userRepository.updateProfile(targetUserId, {
            email: normalizedEmail,
            firstName: input.firstName === null ? "" : input.firstName,
            lastName: input.lastName === null ? "" : input.lastName,
            emailVerified: normalizedEmail && normalizedEmail !== user.email
                ? input.emailVerified ?? false
                : input.emailVerified,
        });

        if (!updated) {
            throw Object.assign(new Error("Failed to update user profile"), { statusCode: 500 });
        }

        return {
            userId: updated.id,
            email: updated.email,
            firstName: updated.firstName,
            lastName: updated.lastName,
            emailVerified: updated.emailVerified,
        };
    }
}