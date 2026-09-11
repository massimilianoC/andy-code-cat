import { describe, it, expect } from "vitest";
import type {
    WorkSessionDetailDto,
    PromptExecutionLogDetailDto,
    CostTransactionDetailDto,
} from "@andy-code-cat/contracts";
import { pickLatestSession, latestLogForStage, costForLog, canonicalBriefOf, blocksPresent, shouldFetchSessionDetail, detailRequestKey } from "../sessionSelectors";

function log(overrides: Partial<PromptExecutionLogDetailDto>): PromptExecutionLogDetailDto {
    return {
        id: "log-1",
        taskKey: "task",
        provider: "siliconflow",
        model: "m",
        inputPrompt: "in",
        status: "succeeded",
        durationMs: 100,
        createdAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function costTx(overrides: Partial<CostTransactionDetailDto>): CostTransactionDetailDto {
    return {
        id: "tx-1",
        txId: "TX-1",
        resourceType: "llm.chat",
        totalEur: 0,
        providerCostEur: 0,
        infraCostEur: 0,
        platformMarkupEur: 0,
        ratesSnapshot: {
            usdToEurRate: 1,
            platformMarkupPct: 0,
            infraCostPct: 0,
            textEurPer1kTokens: 0,
            imageEurPerAsset: 0,
            videoEurPerAsset: 0,
        },
        units: {},
        sourceRef: {},
        status: "settled",
        createdAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function emptyDetail(overrides: Partial<WorkSessionDetailDto>): WorkSessionDetailDto {
    return {
        id: "session-1",
        entryMode: "workspace",
        status: "completed",
        config: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        vibeIntakes: [],
        zeroEffortFormProposals: [],
        pipelineRuns: [],
        promptExecutionLogs: [],
        costTransactions: [],
        artifacts: [],
        ...overrides,
    };
}

describe("pickLatestSession", () => {
    it("picks the first entry — the list endpoint already returns newest-first", () => {
        const sessions = [
            { id: "b", entryMode: "workspace" as const, status: "completed" as const, createdAt: "x", stages: [], totalCostEur: 0, totalDurationMs: 0, truncated: false },
            { id: "a", entryMode: "workspace" as const, status: "completed" as const, createdAt: "y", stages: [], totalCostEur: 0, totalDurationMs: 0, truncated: false },
        ];
        expect(pickLatestSession(sessions)?.id).toBe("b");
    });

    it("returns undefined for an empty list", () => {
        expect(pickLatestSession([])).toBeUndefined();
    });
});

describe("latestLogForStage", () => {
    it("returns undefined when the stage never ran", () => {
        expect(latestLogForStage([], "generate")).toBeUndefined();
        expect(latestLogForStage([log({ pipelineStage: "vibe_classify" })], "generate")).toBeUndefined();
    });

    it("picks the most recent row when a stage ran more than once (e.g. a re-generate)", () => {
        const older = log({ id: "old", pipelineStage: "generate", createdAt: "2026-01-01T00:00:00.000Z" });
        const newer = log({ id: "new", pipelineStage: "generate", createdAt: "2026-01-02T00:00:00.000Z" });
        expect(latestLogForStage([older, newer], "generate")?.id).toBe("new");
        expect(latestLogForStage([newer, older], "generate")?.id).toBe("new");
    });
});

describe("costForLog", () => {
    it("sums every row attributed to that exact log id", () => {
        const rows: CostTransactionDetailDto[] = [
            costTx({ totalEur: 0.1, sourceRef: { promptExecutionLogId: "log-a" } }),
            costTx({ totalEur: 0.2, sourceRef: { promptExecutionLogId: "log-a" } }),
            costTx({ totalEur: 0.3, sourceRef: { promptExecutionLogId: "log-b" } }),
        ];
        expect(costForLog(rows, "log-a")).toBeCloseTo(0.3, 5);
    });

    it("returns 0 for an undefined log id", () => {
        expect(costForLog([costTx({ totalEur: 1 })], undefined)).toBe(0);
    });

    // Matches ListWorkSessionSummaries' own totalCostEur sum exactly (no status filter), so a
    // block's cost and the session's summary total agree (spec §6.7).
    it("per-block sums add up to the session total the same way the summary endpoint computes it", () => {
        const rows: CostTransactionDetailDto[] = [
            costTx({ totalEur: 0.05, sourceRef: { promptExecutionLogId: "classify-1" } }),
            costTx({ totalEur: 0.02, sourceRef: { promptExecutionLogId: "prefill-1" } }),
            costTx({ totalEur: 0.42, sourceRef: { promptExecutionLogId: "generate-1" } }),
        ];
        const sessionTotal = rows.reduce((sum, tx) => sum + (tx.totalEur ?? 0), 0);
        const perBlockTotal =
            costForLog(rows, "classify-1") + costForLog(rows, "prefill-1") + costForLog(rows, "generate-1");
        expect(perBlockTotal).toBeCloseTo(sessionTotal, 5);
    });
});

describe("canonicalBriefOf / blocksPresent", () => {
    it("a workspace-only session with just a generate row shows Generation alone", () => {
        const detail = emptyDetail({
            entryMode: "workspace",
            promptExecutionLogs: [log({ pipelineStage: "generate" })],
        });
        expect(canonicalBriefOf(detail)).toBeUndefined();
        expect(blocksPresent(detail)).toEqual({ vibe: false, zeroEffort: false, generation: true });
    });

    it("a full vibe -> zero-effort -> generate session shows all three blocks", () => {
        const detail = emptyDetail({
            entryMode: "vibe",
            vibeIntakes: [
                {
                    id: "vi-1",
                    userId: "u1",
                    prompt: "make a bakery site",
                    attachments: [],
                    promptExecutionLogIds: [],
                    createdAt: "2026-01-01T00:00:00.000Z",
                },
            ],
            pipelineRuns: [
                {
                    id: "run-1",
                    projectId: "p1",
                    entryMode: "vibe",
                    modelLock: {
                        policy: "legacy",
                        requested: { providerId: "siliconflow", modelId: "m", catalogRevision: "r1" },
                        effective: { providerId: "siliconflow", modelId: "m" },
                        selectedAt: "2026-01-01T00:00:00.000Z",
                        selectedBy: "user",
                    },
                    status: "completed",
                    stages: [],
                    canonicalBrief: {
                        schemaVersion: "canonical-brief-v1",
                        content: "brief text",
                        contentHash: "hash-1",
                        provenance: ["vibe"],
                        sourceFields: { businessName: "Acme" },
                        builtAt: "2026-01-01T00:00:00.000Z",
                    },
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                },
            ],
            promptExecutionLogs: [log({ pipelineStage: "generate" })],
        });
        expect(canonicalBriefOf(detail)?.contentHash).toBe("hash-1");
        expect(blocksPresent(detail)).toEqual({ vibe: true, zeroEffort: true, generation: true });
    });

    it("a session with nothing recorded yet (still-open, no logs) shows no blocks", () => {
        expect(blocksPresent(emptyDetail({}))).toEqual({ vibe: false, zeroEffort: false, generation: false });
    });
});

describe("detailRequestKey", () => {
    it("is a new key on every read of the list, even for the same session", () => {
        // The Project Mode case: the second generation lands in the session the first one opened.
        // Keyed on the session id alone, that detail was read once and the new turn never shown.
        expect(detailRequestKey("s1", 1)).not.toBe(detailRequestKey("s1", 2));
    });

    it("has no key without a session", () => {
        expect(detailRequestKey(undefined, 3)).toBeNull();
    });
});

describe("shouldFetchSessionDetail", () => {
    const base = { requestKey: "s1#1", anyBlockOpen: true, startedFor: null };

    it("fetches when a block is open and nothing has been started yet", () => {
        expect(shouldFetchSessionDetail(base)).toBe(true);
    });

    it("does not start the same read twice", () => {
        // An effect re-run for an unrelated reason (a block toggled, a re-render) must not fire a
        // duplicate request for a key already started.
        expect(shouldFetchSessionDetail({ ...base, startedFor: "s1#1" })).toBe(false);
    });

    it("starts a new read for a new key while an older one is still out", () => {
        // The hang this replaces: a re-run mid-request was skipped as "already in flight" while
        // the request it deferred to had just been cancelled by the effect cleanup. A newer key
        // always starts; the caller discards the older response by sequence number.
        expect(shouldFetchSessionDetail({ ...base, requestKey: "s1#2", startedFor: "s1#1" })).toBe(true);
        expect(shouldFetchSessionDetail({ ...base, requestKey: "s2#1", startedFor: "s1#1" })).toBe(true);
    });

    it("waits until a block is actually open, and needs a session", () => {
        expect(shouldFetchSessionDetail({ ...base, anyBlockOpen: false })).toBe(false);
        expect(shouldFetchSessionDetail({ ...base, requestKey: null })).toBe(false);
    });
});
