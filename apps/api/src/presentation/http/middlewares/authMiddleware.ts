import type { NextFunction, Response } from "express";
import { verifyAccessToken } from "../../../infra/security/jwt";
import { MongoUserRepository } from "../../../infra/repositories/MongoUserRepository";
import type { RequestWithContext } from "../types";

const userRepo = new MongoUserRepository();

/**
 * Resolves the bearer token to an account that exists and is not blocked.
 *
 * Roles come from the account record, not from the token: a token carries the roles it was issued
 * with, so trusting it would keep a demoted account's privileges until the token expires. The
 * record is read anyway for the blocked check, so this costs nothing extra.
 *
 * Several routers mount this middleware; within one request the account is resolved once.
 */
export function authMiddleware(req: RequestWithContext, res: Response, next: NextFunction): void {
    if (req.auth) {
        next();
        return;
    }
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing bearer token" });
        return;
    }

    const token = header.slice("Bearer ".length);

    try {
        const payload = verifyAccessToken(token);

        // Reject blocked users on every authenticated request.
        userRepo.findById(payload.sub).then(user => {
            if (!user || user.isBlocked) {
                res.status(403).json({ error: "Account suspended" });
                return;
            }
            req.auth = { userId: payload.sub, roles: [...user.roles] };
            next();
        }).catch(() => {
            res.status(500).json({ error: "Internal error" });
        });
    } catch {
        res.status(401).json({ error: "Invalid access token" });
    }
}
