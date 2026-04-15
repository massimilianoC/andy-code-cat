import type { NextFunction, Request, Response } from "express";
import { normalizeHttpError } from "../errors/httpError";

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
    // If headers are already flushed (e.g. SSE stream started), we cannot set new
    // status codes or headers. End the response to prevent it from hanging.
    if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
    }

    const normalized = normalizeHttpError(error);
    const level = normalized.statusCode >= 500 ? "error" : "warn";
    console[level]("[API error]", {
        statusCode: normalized.statusCode,
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
    });

    res.status(normalized.statusCode).json({
        error: normalized.userMessage,
        code: normalized.code,
        status: normalized.statusCode,
        userMessage: normalized.userMessage,
        details: normalized.details,
    });
}
