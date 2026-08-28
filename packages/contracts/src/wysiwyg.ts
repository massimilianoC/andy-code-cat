import { z } from "zod";

// ── Input schemas ─────────────────────────────────────────────────────────────

export const createWysiwygEditSessionSchema = z.object({
    conversationId: z.string().min(1).max(100),
    originSnapshotId: z.string().min(1).max(100),
    currentHtml: z.string().max(200000).default(""),
    currentCss: z.string().max(100000).default(""),
    currentJs: z.string().max(100000).default(""),
});

export const saveWysiwygEditStateSchema = z.object({
    html: z.string().max(200000),
    css: z.string().max(100000).default(""),
    js: z.string().max(100000).default(""),
});

export const commitWysiwygSessionSchema = z.object({
    /** Optional human-readable description stored in snapshot metadata. */
    description: z.string().max(300).optional(),
    /**
     * AL-040 — the contentHash of the origin version this session was opened on, as the
     * client received it. Declared at commit rather than at session open so the check happens
     * at the moment of the write, which is when the base can actually have moved.
     */
    baseContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type CreateWysiwygEditSessionInput = z.infer<typeof createWysiwygEditSessionSchema>;
export type SaveWysiwygEditStateInput = z.infer<typeof saveWysiwygEditStateSchema>;
export type CommitWysiwygSessionInput = z.infer<typeof commitWysiwygSessionSchema>;

export interface WysiwygEditSessionDto {
    id: string;
    projectId: string;
    userId: string;
    conversationId: string;
    originSnapshotId: string;
    currentHtml: string;
    currentCss: string;
    currentJs: string;
    committedSnapshotId?: string;
    operationCount: number;
    status: "active" | "committed";
    createdAt: string;
    updatedAt: string;
}
