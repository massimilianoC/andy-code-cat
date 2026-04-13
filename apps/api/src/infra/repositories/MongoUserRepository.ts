import { ObjectId, type Collection, type Filter } from "mongodb";
import type { User } from "../../domain/entities/User";
import type { UserLimits, UserRole } from "../../domain/entities/User";
import type { CreateUserInput, UpdateUserProfileInput, UserRepository } from "../../domain/repositories/UserRepository";
import type { ListUsersFilter, ListUsersResult } from "../../domain/repositories/UserRepository";
import { getDb } from "../db/mongo";

interface UserDocument {
    _id: ObjectId;
    email: string;
    passwordHash: string;
    passwordPolicyVersion?: number;
    firstName?: string;
    lastName?: string;
    emailVerified: boolean;
    isBlocked: boolean;
    roles: UserRole[];
    llmPreferences?: User["llmPreferences"];
    limits?: UserLimits;
    tokensConsumedLifetime?: number;
    createdAt: Date;
}

function mapDocument(doc: UserDocument): User {
    return {
        id: doc._id.toHexString(),
        email: doc.email,
        passwordHash: doc.passwordHash,
        passwordPolicyVersion: doc.passwordPolicyVersion,
        firstName: doc.firstName,
        lastName: doc.lastName,
        emailVerified: doc.emailVerified,
        isBlocked: doc.isBlocked ?? false,
        roles: doc.roles,
        limits: doc.limits,
        llmPreferences: doc.llmPreferences,
        tokensConsumedLifetime: doc.tokensConsumedLifetime,
        createdAt: doc.createdAt
    };
}

export class MongoUserRepository implements UserRepository {
    private async collection(): Promise<Collection<UserDocument>> {
        const db = await getDb();
        return db.collection<UserDocument>("users");
    }

    async create(input: CreateUserInput): Promise<User> {
        const collection = await this.collection();
        const now = new Date();

        const result = await collection.insertOne({
            _id: new ObjectId(),
            email: input.email.toLowerCase(),
            passwordHash: input.passwordHash,
            passwordPolicyVersion: input.passwordPolicyVersion,
            firstName: input.firstName,
            lastName: input.lastName,
            emailVerified: input.emailVerified,
            isBlocked: false,
            roles: ["user"],
            llmPreferences: input.llmPreferences,
            createdAt: now
        });

        const created = await collection.findOne({ _id: result.insertedId });
        if (!created) {
            throw new Error("Cannot load created user");
        }

        return mapDocument(created);
    }

    async findByEmail(email: string): Promise<User | null> {
        const collection = await this.collection();
        const doc = await collection.findOne({ email: email.toLowerCase() });
        return doc ? mapDocument(doc) : null;
    }

    async findById(userId: string): Promise<User | null> {
        const collection = await this.collection();
        const doc = await collection.findOne({ _id: new ObjectId(userId) });
        return doc ? mapDocument(doc) : null;
    }

    async updatePassword(userId: string, passwordHash: string, passwordPolicyVersion: number): Promise<User | null> {
        const collection = await this.collection();
        const _id = new ObjectId(userId);

        await collection.updateOne(
            { _id },
            {
                $set: {
                    passwordHash,
                    passwordPolicyVersion,
                }
            }
        );

        const updated = await collection.findOne({ _id });
        return updated ? mapDocument(updated) : null;
    }

    async updateProfile(userId: string, input: UpdateUserProfileInput): Promise<User | null> {
        const collection = await this.collection();
        const _id = new ObjectId(userId);
        const $set: Record<string, unknown> = {};

        if (input.email !== undefined) {
            $set.email = input.email.toLowerCase();
        }
        if (input.firstName !== undefined) {
            $set.firstName = input.firstName;
        }
        if (input.lastName !== undefined) {
            $set.lastName = input.lastName;
        }
        if (input.emailVerified !== undefined) {
            $set.emailVerified = input.emailVerified;
        }

        await collection.updateOne({ _id }, { $set });
        const updated = await collection.findOne({ _id });
        return updated ? mapDocument(updated) : null;
    }

    async setPasswordPolicyVersion(userId: string, passwordPolicyVersion: number): Promise<User | null> {
        const collection = await this.collection();
        const _id = new ObjectId(userId);

        await collection.updateOne(
            { _id },
            {
                $set: {
                    passwordPolicyVersion,
                }
            }
        );

        const updated = await collection.findOne({ _id });
        return updated ? mapDocument(updated) : null;
    }

    async setBlocked(userId: string, isBlocked: boolean): Promise<void> {
        const collection = await this.collection();
        await collection.updateOne(
            { _id: new ObjectId(userId) },
            { $set: { isBlocked } }
        );
    }

    async listPaginated(page: number, limit: number, filter?: ListUsersFilter): Promise<ListUsersResult> {
        const collection = await this.collection();
        const query: Filter<UserDocument> = {};

        if (filter?.search) {
            const escaped = filter.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const re = new RegExp(escaped, "i");
            query.$or = [
                { email: re },
                { firstName: re },
                { lastName: re },
            ];
        }
        if (filter?.role !== undefined) {
            query.roles = filter.role as UserRole;
        }
        if (filter?.isBlocked !== undefined) {
            query.isBlocked = filter.isBlocked;
        }

        const skip = (page - 1) * limit;
        const [users, total] = await Promise.all([
            collection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
            collection.countDocuments(query),
        ]);
        return { users: users.map(mapDocument), total };
    }

    async setRoles(userId: string, roles: UserRole[]): Promise<void> {
        const collection = await this.collection();
        await collection.updateOne(
            { _id: new ObjectId(userId) },
            { $set: { roles } }
        );
    }

    async setLimits(userId: string, limits: UserLimits): Promise<void> {
        const collection = await this.collection();
        await collection.updateOne(
            { _id: new ObjectId(userId) },
            { $set: { limits } }
        );
    }

    async countAll(): Promise<number> {
        const collection = await this.collection();
        return collection.countDocuments();
    }

    async countBlocked(): Promise<number> {
        const collection = await this.collection();
        return collection.countDocuments({ isBlocked: true });
    }

    async deleteById(userId: string): Promise<void> {
        const collection = await this.collection();
        await collection.deleteOne({ _id: new ObjectId(userId) });
    }

    async sumTokensConsumedLifetime(): Promise<number> {
        const collection = await this.collection();
        const agg = await collection
            .aggregate<{ total: number }>([{ $group: { _id: null, total: { $sum: "$tokensConsumedLifetime" } } }])
            .next();
        return agg?.total ?? 0;
    }

    async incrementTokensConsumed(userId: string, tokens: number): Promise<void> {
        if (tokens <= 0) return;
        const collection = await this.collection();
        await collection.updateOne(
            { _id: new ObjectId(userId) },
            { $inc: { tokensConsumedLifetime: tokens } },
        );
    }
}
