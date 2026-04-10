import { config as loadEnv } from "dotenv";
import { MongoUserRepository } from "../infra/repositories/MongoUserRepository";
import { MongoProjectRepository } from "../infra/repositories/MongoProjectRepository";
import { MongoUserStyleProfileRepository } from "../infra/repositories/MongoUserStyleProfileRepository";
import { hashPassword } from "../infra/security/password";
import { env } from "../config";

loadEnv();

async function run() {
    const userRepository = new MongoUserRepository();
    const projectRepository = new MongoProjectRepository();
    const profileRepository = new MongoUserStyleProfileRepository();

    const email = "owner@andy-code-cat.local";
    const existing = await userRepository.findByEmail(email);

    let userId: string;

    if (!existing) {
        const user = await userRepository.create({
            email,
            passwordHash: await hashPassword("ChangeMe123!"),
            firstName: "Owner",
            lastName: "Seed",
            emailVerified: true,
            llmPreferences: {
                defaultProvider: env.LLM_DEFAULT_PROVIDER
            }
        });
        userId = user.id;

        await projectRepository.create(userId, "Seed Project");
        console.log("Seed completed. User owner@andy-code-cat.local created.");
    } else {
        userId = existing.id;
        const projects = await projectRepository.listForUser(userId);
        if (projects.length === 0) {
            await projectRepository.create(userId, "Seed Project");
        }
        console.log("Seed skipped. User already exists.");
    }

    // Ensure style profile exists (idempotent)
    await profileRepository.initForUser({
        userId,
        onboardingCompleted: false,
        onboardingStep: 0,
        identityTags: [],
        sectorTags: [],
        audienceTags: [],
        visualTags: [],
        paletteTags: [],
        typographyTags: [],
        layoutTags: [],
        toneTags: [],
        referenceTags: [],
        featureTags: [],
    });
    console.log("Style profile initialized for seed user.");
}

run().catch((error) => {
    console.error("Seed failed", error);
    process.exit(1);
});
