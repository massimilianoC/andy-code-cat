import { MongoClient, type Db } from "mongodb";
import { env } from "../../config";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
    if (db) {
        return db;
    }

    if (!client) {
        // Assumption: API runs as a long-lived container process with moderate concurrency.
        client = new MongoClient(env.MONGODB_URI, {
            maxPoolSize: 30,
            minPoolSize: 5,
            maxIdleTimeMS: 5 * 60 * 1000,
            connectTimeoutMS: 10_000,
            socketTimeoutMS: 30_000,
            serverSelectionTimeoutMS: 5_000
        });
    }

    await client.connect();
    db = client.db(env.MONGODB_DB_NAME);
    return db;
}
