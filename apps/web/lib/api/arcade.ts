import type { LeaderboardEntryDto, LeaderboardSubmitResultDto, SubmitLeaderboardScoreInput } from "@andy-code-cat/contracts";
import { call } from "./call";
import type { PreviewSnapshot } from "./snapshots";

const headers = (token: string, projectId: string) => ({ Authorization: `Bearer ${token}`, "x-project-id": projectId });

export function getPreviewSnapshot(token: string, projectId: string, snapshotId: string) {
    return call<{ snapshot: PreviewSnapshot }>(
        "GET",
        `/v1/projects/${projectId}/preview-snapshots/${encodeURIComponent(snapshotId)}`,
        undefined,
        headers(token, projectId),
    );
}

export function getLeaderboard(token: string, projectId: string, boardId = "default", limit = 10) {
    const qs = `?boardId=${encodeURIComponent(boardId)}&limit=${limit}`;
    return call<{ boardId: string; entries: LeaderboardEntryDto[] }>(
        "GET",
        `/v1/projects/${projectId}/leaderboard${qs}`,
        undefined,
        headers(token, projectId),
    );
}

export function submitLeaderboardScore(token: string, projectId: string, input: Partial<SubmitLeaderboardScoreInput> & { player: string; score: number }) {
    return call<LeaderboardSubmitResultDto>(
        "POST",
        `/v1/projects/${projectId}/leaderboard`,
        input,
        headers(token, projectId),
    );
}
