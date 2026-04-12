import { setUserRolesSchema } from "@andy-code-cat/contracts";
import type { UserRepository } from "../../../domain/repositories/UserRepository";

export class SetUserRole {
    constructor(private readonly userRepository: UserRepository) {}

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
        return { userId: targetUserId, roles };
    }
}
