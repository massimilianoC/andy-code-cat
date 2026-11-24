import type { BackgroundRunDto, CreateBackgroundRunInput } from "@andy-code-cat/contracts";
import { call } from "./call";

/** Starts a background run (docs/specs/BACKGROUND_RUNS.md): returns at once with the queued run. */
export function startBackgroundRun(token: string, input: CreateBackgroundRunInput) {
    return call<{ run: BackgroundRunDto }>("POST", "/v1/background-runs", input, {
        Authorization: `Bearer ${token}`,
    });
}

export function listBackgroundRuns(token: string, limit = 10) {
    return call<{ runs: BackgroundRunDto[] }>("GET", `/v1/background-runs?limit=${limit}`, undefined, {
        Authorization: `Bearer ${token}`,
    });
}

export function cancelBackgroundRun(token: string, runId: string) {
    return call<{ run: BackgroundRunDto }>("POST", `/v1/background-runs/${encodeURIComponent(runId)}/cancel`, undefined, {
        Authorization: `Bearer ${token}`,
    });
}
