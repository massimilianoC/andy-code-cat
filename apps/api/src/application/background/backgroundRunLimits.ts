/**
 * The limits of background runs (BACKGROUND_RUNS.md §6.3), as the superadmin set them in
 * PlatformConfig. A field never saved takes the deployment's BACKGROUND_RUN_* value, and the
 * answer says which applied. Every path that enforces a limit reads it here: the start route
 * (per user), the worker (pool) and the engine (cost ceiling) — at each use, so a change applies
 * without a restart.
 */
import type { BackgroundRunLimitsDto } from "@andy-code-cat/contracts";
import { env } from "../../config";
import type { PlatformConfig } from "../../domain/entities/PlatformConfig";
import type { PlatformConfigRepository } from "../../domain/repositories/PlatformConfigRepository";

export function resolveBackgroundRunLimits(config: Pick<PlatformConfig, "backgroundRuns"> | null | undefined): BackgroundRunLimitsDto {
    const stored = config?.backgroundRuns ?? {};
    const saved = stored.maxPerUser !== undefined || stored.poolSize !== undefined || stored.maxCostEur !== undefined;
    return {
        maxPerUser: stored.maxPerUser ?? env.BACKGROUND_RUN_MAX_PER_USER,
        poolSize: stored.poolSize ?? env.BACKGROUND_RUN_POOL_SIZE,
        maxCostEur: stored.maxCostEur ?? env.BACKGROUND_RUN_MAX_COST_EUR,
        source: saved ? "config" : "environment",
    };
}

/** Reads the current limits; a configuration that cannot be read falls back to the environment, logged. */
export function backgroundRunLimitsReader(repository: PlatformConfigRepository): () => Promise<BackgroundRunLimitsDto> {
    return async () => {
        try {
            return resolveBackgroundRunLimits(await repository.get());
        } catch (error) {
            console.warn("[background-run] platform config unreadable, environment limits apply", error);
            return resolveBackgroundRunLimits(null);
        }
    };
}
