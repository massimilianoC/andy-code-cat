import { z } from "zod";

export const apiErrorResponseSchema = z.object({
    error: z.string(),
    code: z.string().optional(),
    status: z.number().int().nonnegative().optional(),
    userMessage: z.string().optional(),
    details: z.unknown().optional(),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;