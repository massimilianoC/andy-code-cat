import { z } from "zod";

/**
 * Background runs — the Vibe flow carried by the server, detached from the browser
 * (docs/specs/BACKGROUND_RUNS.md). One run = one project, worked through these steps in order.
 */
export const BACKGROUND_RUN_STEPS = [
    "classifying",
    "briefing",
    "launching",
    "generating",
    "snapshotting",
    "publishing",
] as const;

export const BACKGROUND_RUN_TERMINAL_STATUSES = ["done", "failed", "cancelled"] as const;

export const backgroundRunStatusSchema = z.enum([
    "queued",
    ...BACKGROUND_RUN_STEPS,
    ...BACKGROUND_RUN_TERMINAL_STATUSES,
]);

export type BackgroundRunStep = (typeof BACKGROUND_RUN_STEPS)[number];
export type BackgroundRunStatus = z.infer<typeof backgroundRunStatusSchema>;

/** Same ceiling as the Vibe prompt (vibecoreRoutes VIBE_PROMPT_MAX_CHARS). */
export const BACKGROUND_RUN_PROMPT_MAX_CHARS = 12000;

export const createBackgroundRunSchema = z.object({
    prompt: z.string().trim().min(10).max(BACKGROUND_RUN_PROMPT_MAX_CHARS),
    /** BCP-47 UI language, as Vibe sends it. */
    uiLanguage: z.string().min(2).max(10).optional(),
    /** Pipeline model override, as Vibe sends it; resolved against the catalog like any other request. */
    provider: z.string().min(1).max(80).optional(),
    model: z.string().min(1).max(200).optional(),
}).strict();

export type CreateBackgroundRunInput = z.infer<typeof createBackgroundRunSchema>;

export interface BackgroundRunTransitionDto {
    status: BackgroundRunStatus;
    phase: "started" | "completed" | "failed" | "cancelled" | "deferred";
    at: string;
    detail?: string;
}

export interface BackgroundRunDto {
    id: string;
    projectId: string;
    status: BackgroundRunStatus;
    prompt: string;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
    costEur: number;
    cancelRequested: boolean;
    transitions: BackgroundRunTransitionDto[];
    /** Present once the site is live. */
    site?: {
        publishId: string;
        publicUrl: string;
        /** A free, valid slug the user may adopt with one click (nothing is reserved). */
        proposedSlug?: string;
    };
    error?: { code: string; message: string; step?: BackgroundRunStatus };
}
