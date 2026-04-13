import { listUsersQuerySchema } from "@andy-code-cat/contracts";
import type { UserRepository } from "../../../domain/repositories/UserRepository";

export class ListUsers {
    constructor(private readonly userRepository: UserRepository) {}

    async execute(rawQuery: unknown) {
        const { page, limit, search, role, isBlocked } = listUsersQuerySchema.parse(rawQuery);
        const filter = {
            search,
            role,
            isBlocked: isBlocked === undefined ? undefined : isBlocked === "true",
        };
        const { users, total } = await this.userRepository.listPaginated(page, limit, filter);
        return {
            users: users.map(u => ({
                id: u.id,
                email: u.email,
                firstName: u.firstName,
                lastName: u.lastName,
                emailVerified: u.emailVerified,
                isBlocked: u.isBlocked,
                roles: u.roles,
                limits: u.limits,
                createdAt: u.createdAt.toISOString(),
            })),
            total,
            page,
            limit,
        };
    }
}
