import type { NextFunction, Response } from "express";
import type { RequestWithContext } from "../types";

/**
 * Requires the caller to carry the "superadmin" role in their JWT.
 * Must be applied after authMiddleware (which populates req.auth).
 */
export function requireSuperAdmin(req: RequestWithContext, res: Response, next: NextFunction): void {
    if (!req.auth?.roles?.includes("superadmin")) {
        res.status(403).json({ error: "Forbidden — superadmin access required" });
        return;
    }
    next();
}
