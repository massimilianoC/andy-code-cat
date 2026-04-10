import type { NextFunction, Response } from "express";
import { verifyAccessToken } from "../../../infra/security/jwt";
import { MongoUserRepository } from "../../../infra/repositories/MongoUserRepository";
import type { RequestWithContext } from "../types";

const userRepo = new MongoUserRepository();

export function authMiddleware(req: RequestWithContext, res: Response, next: NextFunction): void {
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
            req.auth = { userId: payload.sub, roles: payload.roles };
            next();
        }).catch(() => {
            res.status(500).json({ error: "Internal error" });
        });
    } catch {
        res.status(401).json({ error: "Invalid access token" });
    }
}
