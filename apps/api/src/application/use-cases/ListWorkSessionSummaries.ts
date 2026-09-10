import type { PipelineEntryMode, PipelineStage } from "@andy-code-cat/contracts";
import type { WorkSessionRepository } from "../../domain/repositories/WorkSessionRepository";
import type { PipelineRunRepository } from "../../domain/repositories/PipelineRunRepository";
import type { PromptExecutionLogRepository } from "../../domain/repositories/PromptExecutionLogRepository";
import type { ICostTransactionRepository } from "../../domain/repositories/ICostTransactionRepository";
import type { WorkSessionStatus } from "../../domain/entities/WorkSession";
import { wasTruncated } from "../../domain/entities/PromptExecutionLog";
// The wire shape lives in contracts — the web client renders it, so it cannot be declared here too.
import type { WorkSessionSummaryDto } from "@andy-code-cat/contracts";
export type { WorkSessionSummaryDto };


export class ListWorkSessionSummaries {
    constructor(
        private readonly workSessionRepository: WorkSessionRepository,
        private readonly pipelineRunRepository: PipelineRunRepository,
        private readonly promptExecutionLogRepository: PromptExecutionLogRepository,
        private readonly costTransactionRepository: ICostTransactionRepository,
    ) {}

    async execute(projectId: string, userId: string): Promise<WorkSessionSummaryDto[]> {
        const [sessions, runs] = await Promise.all([
            this.workSessionRepository.listByProject(projectId, userId),
            this.pipelineRunRepository.listByProject(projectId, userId),
        ]);

        return Promise.all(
            sessions.map(async (session) => {
                const sessionRuns = runs.filter((run) => run.workSessionId === session.id);
                const stages: PipelineStage[] = [];
                for (const run of sessionRuns) {
                    for (const stageRef of run.stages) {
                        if (!stages.includes(stageRef.stage)) stages.push(stageRef.stage);
                    }
                }

                const [logs, costTxs] = await Promise.all([
                    this.promptExecutionLogRepository.listByWorkSession(session.id, userId),
                    this.costTransactionRepository.findBySourceRef({ workSessionId: session.id }),
                ]);

                const totalDurationMs = logs.reduce((sum, log) => sum + (log.durationMs ?? 0), 0);
                const truncated = logs.some((log) => wasTruncated(log));
                const totalCostEur = costTxs.reduce((sum, tx) => sum + (tx.totalEur ?? 0), 0);

                return {
                    id: session.id,
                    entryMode: session.entryMode,
                    status: session.status,
                    createdAt: session.createdAt.toISOString(),
                    stages,
                    totalCostEur,
                    totalDurationMs,
                    truncated,
                } satisfies WorkSessionSummaryDto;
            }),
        );
    }
}
