import { call } from "./call";
import { getAccessToken } from "../token-store";
import type {
    WorkSessionSummaryDto,
    WorkSessionSummaryListResponse,
    WorkSessionDetailDto,
    WorkSessionDetailResponse,
} from "@andy-code-cat/contracts";

/**
 * Client for the Session Inspector's two read endpoints (docs/specs/SESSION_INSPECTOR_SPEC.md §2).
 * Both are project-scoped and require the same `x-project-id` header as the rest of the project
 * API surface (see apps/web/lib/api/cost.ts for the identical pattern).
 *
 * Deliberately two functions, not one: `listWorkSessions` is safe to call on every page load (no
 * prompt bodies in the response), `getWorkSessionDetail` is not — it returns full prompt bodies
 * and must only be called once a block that needs them is expanded (spec §5.5).
 */

export type { WorkSessionSummaryDto, WorkSessionDetailDto };

function authAndProjectHeaders(projectId: string): Record<string, string> {
    const token = getAccessToken();
    return {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "x-project-id": projectId,
    };
}

/** The project's work sessions, newest first, with no prompt bodies. */
export async function listWorkSessions(projectId: string): Promise<WorkSessionSummaryDto[]> {
    const res = await call<WorkSessionSummaryListResponse>(
        "GET",
        `/v1/projects/${encodeURIComponent(projectId)}/work-sessions`,
        undefined,
        authAndProjectHeaders(projectId),
    );
    return res.sessions;
}

/** One session in full, including prompt bodies, the brief, and cost rows. */
export async function getWorkSessionDetail(projectId: string, workSessionId: string): Promise<WorkSessionDetailDto> {
    const res = await call<WorkSessionDetailResponse>(
        "GET",
        `/v1/projects/${encodeURIComponent(projectId)}/work-sessions/${encodeURIComponent(workSessionId)}`,
        undefined,
        authAndProjectHeaders(projectId),
    );
    return res.session;
}
