import type { UserRepository } from "../../../domain/repositories/UserRepository";

export class DeleteUser {
    constructor(private readonly userRepository: UserRepository) {}

    async execute(targetUserId: string, callerUserId: string) {
        if (targetUserId === callerUserId) {
            throw Object.assign(new Error("Cannot delete your own account"), { statusCode: 400 });
        }

        const user = await this.userRepository.findById(targetUserId);
        if (!user) {
            throw Object.assign(new Error("User not found"), { statusCode: 404 });
        }

        if (user.roles.includes("superadmin")) {
            throw Object.assign(new Error("Cannot delete a superadmin account"), { statusCode: 403 });
        }

        await this.userRepository.deleteById(targetUserId);
        return { deleted: true, userId: targetUserId };
    }
}
