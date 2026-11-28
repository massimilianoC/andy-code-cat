import type { NextFunction, Response } from "express";
import type { RequestWithContext } from "../types";

/**
 * Requires the caller's account to hold the "superadmin" role.
 * Must be applied after authMiddleware, which populates req.auth with the roles of the account
 * record (not the roles written in the token).
 */
export function requireSuperAdmin(req: RequestWithContext, res: Response, next: NextFunction): void {
    if (!req.auth?.roles?.includes("superadmin")) {
        res.status(403).json({ error: "Forbidden — superadmin access required" });
        return;
    }
    next();
}
