import type { ZodError } from "zod";

export interface HttpErrorOptions {
    statusCode: number;
    code?: string;
    userMessage?: string;
    details?: unknown;
}

export class HttpError extends Error {
    readonly statusCode: number;
    readonly code?: string;
    readonly userMessage?: string;
    readonly details?: unknown;

    constructor(message: string, options: HttpErrorOptions) {
        super(message);
        this.name = "HttpError";
        this.statusCode = options.statusCode;
        this.code = options.code;
        this.userMessage = options.userMessage;
        this.details = options.details;
    }
}

export interface NormalizedHttpError {
    statusCode: number;
    code?: string;
    message: string;
    userMessage: string;
    details?: unknown;
}

function isZodError(error: unknown): error is ZodError {
    return error !== null && typeof error === "object" && "issues" in error && Array.isArray((error as { issues?: unknown }).issues);
}

export function normalizeHttpError(error: unknown): NormalizedHttpError {
    if (error instanceof HttpError) {
        return {
            statusCode: error.statusCode,
            code: error.code,
            message: error.message,
            userMessage: error.userMessage ?? error.message,
            details: error.details,
        };
    }

    if (isZodError(error)) {
        return {
            statusCode: 400,
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            userMessage: "Alcuni campi della richiesta non sono validi.",
            details: error.flatten(),
        };
    }

    if (error instanceof Error) {
        const candidate = error as Error & { statusCode?: number; code?: string; userMessage?: string; details?: unknown };
        const statusCode = typeof candidate.statusCode === "number" ? candidate.statusCode : 500;
        return {
            statusCode,
            code: candidate.code,
            message: candidate.message,
            userMessage: candidate.userMessage ?? candidate.message,
            details: candidate.details,
        };
    }

    return {
        statusCode: 500,
        code: "INTERNAL_ERROR",
        message: "Unexpected error",
        userMessage: "Si e verificato un errore inatteso.",
    };
}