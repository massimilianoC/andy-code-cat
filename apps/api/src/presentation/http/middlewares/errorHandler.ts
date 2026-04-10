import type { NextFunction, Request, Response } from "express";

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
    // If headers are already flushed (e.g. SSE stream started), we cannot set new
    // status codes or headers. End the response to prevent it from hanging.
    if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return;
    }
    const message = error instanceof Error ? error.message : "Unexpected error";
    const statusCode = (error as { statusCode?: number }).statusCode ?? 400;
    res.status(statusCode).json({ error: message });
}
