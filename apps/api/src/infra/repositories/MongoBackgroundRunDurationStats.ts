import { BACKGROUND_RUN_STEPS } from "@andy-code-cat/contracts";
import { getDb } from "../db/mongo";
import type { BackgroundRunStep } from "../../domain/entities/BackgroundRun";
import type {
    BackgroundRunDurationStatsSource,
    DurationSample,
} from "../../domain/repositories/BackgroundRunDurationStatsSource";

function median(values: number[]): DurationSample | null {
    const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const middle = Math.floor(sorted.length / 2);
    const medianMs = sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
    return { medianMs: Math.round(medianMs), samples: sorted.length };
}

interface TransitionRow {
    status: string;
    phase: string;
    at: Date;
}

export class MongoBackgroundRunDurationStats implements BackgroundRunDurationStatsSource {
    async stepDurationsFromRuns(limit: number): Promise<Partial<Record<BackgroundRunStep, DurationSample>>> {
        const db = await getDb();
        const runs = await db.collection<{ transitions: TransitionRow[] }>("background_runs")
            .find({ status: "done" }, { projection: { transitions: 1 } })
            .sort({ finishedAt: -1 })
            .limit(limit)
            .toArray();
        const byStep = new Map<BackgroundRunStep, number[]>();
        for (const run of runs) {
            for (const step of BACKGROUND_RUN_STEPS) {
                // The last start of the step (a resumed step restarts) to its completion.
                const started = [...run.transitions].reverse().find((t) => t.status === step && t.phase === "started");
                const completed = run.transitions.find((t) => t.status === step && t.phase === "completed");
                if (!started || !completed) continue;
                const ms = new Date(completed.at).getTime() - new Date(started.at).getTime();
                byStep.set(step, [...(byStep.get(step) ?? []), ms]);
            }
        }
        const result: Partial<Record<BackgroundRunStep, DurationSample>> = {};
        for (const [step, values] of byStep) {
            const sample = median(values);
            if (sample) result[step] = sample;
        }
        return result;
    }

    async journalDuration(input: { taskKey: string; pipelineStage?: string; limit: number }): Promise<DurationSample | null> {
        const db = await getDb();
        const rows = await db.collection<{ durationMs?: number }>("prompt_execution_logs")
            .find(
                {
                    taskKey: input.taskKey,
                    status: "succeeded",
                    ...(input.pipelineStage ? { pipelineStage: input.pipelineStage } : {}),
                },
                { projection: { durationMs: 1 } },
            )
            .sort({ createdAt: -1 })
            .limit(input.limit)
            .toArray();
        return median(rows.map((row) => row.durationMs ?? 0));
    }

    async generationCompletionTokens(limit: number): Promise<DurationSample | null> {
        const db = await getDb();
        const rows = await db.collection<{ usage?: { completionTokens?: number } }>("prompt_execution_logs")
            .find(
                { taskKey: "chat", status: "succeeded", pipelineStage: "generate", pipelineRunId: { $exists: true } },
                { projection: { usage: 1 } },
            )
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();
        return median(rows.map((row) => row.usage?.completionTokens ?? 0));
    }
}
