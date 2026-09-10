import type { NextFunction, Request, Response } from "express";
import { describeError } from "../../../application/errors/describeError";
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
    // The cause chain stays in the log and out of the response: it names internals (hosts,
    // certificates, socket codes) that the operator needs and the client has no business seeing.
    const chain = describeError(error);
    console[level]("[API error]", {
        statusCode: normalized.statusCode,
        code: normalized.code,
        message: normalized.message,
        // Omitted when it would only repeat `message` — most errors carry no cause.
        ...(chain === normalized.message ? {} : { cause: chain }),
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
