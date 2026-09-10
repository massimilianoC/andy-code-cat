/**
 * The two collections that close questions 1 and 4 of
 * docs/specs/SESSION_RECONSTRUCTION_CERTIFICATE.md §3.
 *
 * Before these repositories existed, both questions were unanswerable: nothing persisted the prompt
 * as the user actually typed it, and nothing persisted what the prefill proposed — so "did the user
 * accept the model's suggestion or overrule it" had no record anywhere in the database.
 *
 * Runs against MongoMemoryServer — no Docker required.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { GuidedLaunchInput } from "@andy-code-cat/contracts";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-min-32-chars-!!xy";
process.env.EXPORT_JWT_SECRET = "test-export-secret-min-32-chars-!!xyz";
process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/placeholder";

let mongod: MongoMemoryServer;
let intakes: import("../MongoVibeIntakeRepository").MongoVibeIntakeRepository;
let proposals: import("../MongoZeroEffortFormProposalRepository").MongoZeroEffortFormProposalRepository;

const WS = "ws-cert-1";
const USER = "u-cert-1";

const form = (over: Partial<GuidedLaunchInput> = {}): GuidedLaunchInput => ({
    presetId: "slideshow",
    primaryGoal: "presentare un piano di spese familiari",
    audience: "una famiglia",
    ...over,
} as GuidedLaunchInput);

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri("session-reconstruction-test");
    const { MongoVibeIntakeRepository } = await import("../MongoVibeIntakeRepository");
    const { MongoZeroEffortFormProposalRepository } = await import("../MongoZeroEffortFormProposalRepository");
    intakes = new MongoVibeIntakeRepository();
    proposals = new MongoZeroEffortFormProposalRepository();
});

afterAll(async () => {
    await mongod?.stop();
});

describe("certificate question 1 — what did the user type and attach", () => {
    it("stores the prompt verbatim and the attachments by reference, never their bytes", async () => {
        const saved = await intakes.record({
            workSessionId: WS,
            userId: USER,
            prompt: "un deck da 10 sezioni per una famiglia",
            attachments: [{ filename: "spese.pdf", mimeType: "application/pdf", sizeBytes: 12_000 }],
            requestedModel: "zai-org/GLM-5.3",
        });

        const [found] = await intakes.listByWorkSession(WS, USER);

        expect(found!.prompt).toBe("un deck da 10 sezioni per una famiglia");
        expect(found!.attachments[0]!.filename).toBe("spese.pdf");
        expect(found!.attachments[0]).not.toHaveProperty("content");
        expect(found!.requestedModel).toBe("zai-org/GLM-5.3");
        expect(saved.promptExecutionLogIds).toEqual([]);
    });

    it("does not let a retried stage make one call appear twice in the history", async () => {
        const saved = await intakes.record({
            workSessionId: "ws-dedup", userId: USER, prompt: "x", attachments: [],
        });

        await intakes.appendPromptExecutionLogId(saved.id, "log-1");
        await intakes.appendPromptExecutionLogId(saved.id, "log-1");
        await intakes.appendPromptExecutionLogId(saved.id, "log-2");

        const [found] = await intakes.listByWorkSession("ws-dedup", USER);
        expect(found!.promptExecutionLogIds).toEqual(["log-1", "log-2"]);
    });

    it("is scoped to its owner, so one user's intake never surfaces in another's history", async () => {
        expect(await intakes.listByWorkSession(WS, "someone-else")).toEqual([]);
    });
});

describe("certificate question 4 — did the user accept the prefill or overrule it", () => {
    it("records what the model proposed, with no decision yet", async () => {
        await proposals.record({
            workSessionId: WS,
            userId: USER,
            prefilled: form({ tone: "formale" }),
            editedFields: [],
        });

        const [found] = await proposals.listByWorkSession(WS, USER);
        expect(found!.prefilled.tone).toBe("formale");
        expect(found!.editedFields).toEqual([]);
    });

    it("attaches the decision to the proposal the user was actually looking at", async () => {
        // A user who re-runs the prefill gets a second proposal; the decision belongs to the last
        // one shown, not the first. Getting this wrong would attribute the user's edits to a
        // suggestion they never saw.
        await proposals.record({
            workSessionId: "ws-two", userId: USER, prefilled: form({ tone: "primo" }), editedFields: [],
        });
        await proposals.record({
            workSessionId: "ws-two", userId: USER, prefilled: form({ tone: "secondo" }), editedFields: [],
        });

        await proposals.recordDecision("ws-two", USER, { editedFields: ["tone", "audience"] });

        const all = await proposals.listByWorkSession("ws-two", USER);
        expect(all[0]!.editedFields).toEqual([]);
        expect(all[1]!.prefilled.tone).toBe("secondo");
        expect(all[1]!.editedFields).toEqual(["tone", "audience"]);
    });

    it("does nothing rather than throwing when a session has no proposal to decide on", async () => {
        await expect(
            proposals.recordDecision("ws-never-prefilled", USER, { editedFields: ["tone"] }),
        ).resolves.toBeUndefined();
    });

    it("does not store the confirmed form — canonicalBrief.sourceFields already owns it", async () => {
        const [found] = await proposals.listByWorkSession(WS, USER);

        expect(found).not.toHaveProperty("confirmed");
    });
});
