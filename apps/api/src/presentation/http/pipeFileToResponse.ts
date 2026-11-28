import type { Response } from "express";

/**
 * Pipes a file read stream into an HTTP response without letting a read error escape.
 *
 * A read stream that emits `error` with no listener throws an uncaught exception, which ends the
 * Node process: `stream.pipe(res)` alone attaches no error listener to the source. Every file
 * served to a client goes through here instead.
 *
 * - Error before any byte was sent: the response becomes a 404 (file gone or not a file) or a 500.
 * - Error mid-transfer: the status line is already out, so the connection is closed; the client
 *   sees a truncated body rather than a complete-looking one.
 * - Client gone first: the source is destroyed so the file descriptor is released.
 */
export function pipeFileToResponse(stream: NodeJS.ReadableStream, res: Response, label: string): void {
    const destroySource = () => {
        const destroyable = stream as NodeJS.ReadableStream & { destroy?: () => void };
        destroyable.destroy?.();
    };

    stream.once("error", (error: NodeJS.ErrnoException) => {
        console.error(`[file-response] ${label}: read failed`, { code: error?.code, message: error?.message });
        if (!res.headersSent) {
            const notFound = error?.code === "ENOENT" || error?.code === "EISDIR" || error?.code === "ENOTDIR";
            res.removeHeader("Content-Length");
            res.removeHeader("Content-Disposition");
            res.removeHeader("ETag");
            res.removeHeader("Last-Modified");
            res.setHeader("Cache-Control", "no-store");
            res.status(notFound ? 404 : 500).type("text/plain").send(notFound ? "Not found" : "Internal error");
            return;
        }
        res.destroy();
    });
    res.once("close", destroySource);
    stream.pipe(res);
}
