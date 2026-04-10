import { ObjectId, type Collection } from "mongodb";
import type { User } from "../../domain/entities/User";
import type { CreateUserInput, UserRepository } from "../../domain/repositories/UserRepository";
import { getDb } from "../db/mongo";

interface UserDocument {
    _id: ObjectId;
    email: string;
    passwordHash: string;
    firstName?: string;
    lastName?: string;
    emailVerified: boolean;
    isBlocked: boolean;
    roles: ("user" | "admin")[];
    llmPreferences?: User["llmPreferences"];
    createdAt: Date;
}

function mapDocument(doc: UserDocument): User {
    return {
        id: doc._id.toHexString(),
        email: doc.email,
        passwordHash: doc.passwordHash,
        firstName: doc.firstName,
        lastName: doc.lastName,
        emailVerified: doc.emailVerified,
        isBlocked: doc.isBlocked ?? false,
        roles: doc.roles,
        llmPreferences: doc.llmPreferences,
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

    async setBlocked(userId: string, isBlocked: boolean): Promise<void> {
        const collection = await this.collection();
        await collection.updateOne(
            { _id: new ObjectId(userId) },
            { $set: { isBlocked } }
        );
    }
}
