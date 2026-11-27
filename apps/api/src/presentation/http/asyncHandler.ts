import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ParamsDictionary } from "express-serve-static-core";

/**
 * Express 4 ignores the promise an async handler returns: a rejection never reaches the error
 * middleware and, as an unhandled rejection, ends the Node process. Wrapping the handler forwards
 * any rejection to `next(error)`, where `errorHandler` answers it like any other failure.
 */
export function asyncHandler<P = ParamsDictionary>(
    handler: (req: Request<P>, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler<P> {
    return (req, res, next) => {
        handler(req, res, next).catch(next);
    };
}
