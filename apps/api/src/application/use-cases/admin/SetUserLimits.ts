import { setUserLimitsSchema } from "@andy-code-cat/contracts";
import type { UserRepository } from "../../../domain/repositories/UserRepository";
import type { UserLimits } from "../../../domain/entities/User";
import { DEFAULT_USER_LIMITS } from "../../../domain/entities/User";

export class SetUserLimits {
    constructor(private readonly userRepository: UserRepository) {}

    async execute(targetUserId: string, rawInput: unknown) {
        const partial = setUserLimitsSchema.parse(rawInput);

        const user = await this.userRepository.findById(targetUserId);
        if (!user) {
            throw Object.assign(new Error("User not found"), { statusCode: 404 });
        }

        const current: UserLimits = user.limits ?? { ...DEFAULT_USER_LIMITS };
        const merged: UserLimits = { ...current, ...partial };

        await this.userRepository.setLimits(targetUserId, merged);
        return { userId: targetUserId, limits: merged };
    }
}
