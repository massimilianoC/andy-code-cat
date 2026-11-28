import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { RegisterUser } from "../../../application/use-cases/RegisterUser";
import { LoginUser } from "../../../application/use-cases/LoginUser";
import { RefreshSession } from "../../../application/use-cases/RefreshSession";
import { ChangePassword } from "../../../application/use-cases/ChangePassword";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoSessionRepository } from "../../../infra/repositories/MongoSessionRepository";
import { MongoUserRepository } from "../../../infra/repositories/MongoUserRepository";
import { authMiddleware } from "../middlewares/authMiddleware";
import type { RequestWithContext } from "../types";
import { MongoPlatformConfigRepository } from "../../../infra/repositories/MongoPlatformConfigRepository";

/**
 * Limits on the authentication routes (security review M2). Every attempt costs a bcrypt hash, so
 * these protect both the accounts and the CPU. Login and password change count failures only, so a
 * user (or a test suite) logging in normally is never throttled; registration and refresh count
 * every request.
 */
export const AUTH_RATE_LIMITS = {
    windowMs: 15 * 60 * 1000,
    loginFailuresPerEmail: 10,
    loginFailuresPerIp: 50,
    registrationsPerIp: 10,
    registrationWindowMs: 60 * 60 * 1000,
    refreshesPerIp: 120,
    passwordChangeFailuresPerUser: 10,
} as const;

function normalizedEmail(req: Request): string | null {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
}

function authLimiter(limit: number, options: Partial<Parameters<typeof rateLimit>[0]> = {}) {
    return rateLimit({
        windowMs: AUTH_RATE_LIMITS.windowMs,
        limit,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many attempts, try again later", code: "AUTH_RATE_LIMITED" },
        ...options,
    });
}

export function createAuthRoutes(): Router {
    const router = Router();
    const loginPerIp = authLimiter(AUTH_RATE_LIMITS.loginFailuresPerIp, { skipSuccessfulRequests: true });
    const loginPerEmail = authLimiter(AUTH_RATE_LIMITS.loginFailuresPerEmail, {
        skipSuccessfulRequests: true,
        skip: (req) => normalizedEmail(req) === null,
        keyGenerator: (req) => `email:${normalizedEmail(req)}`,
    });
    const registerPerIp = authLimiter(AUTH_RATE_LIMITS.registrationsPerIp, { windowMs: AUTH_RATE_LIMITS.registrationWindowMs });
    const refreshPerIp = authLimiter(AUTH_RATE_LIMITS.refreshesPerIp);
    const passwordChangePerUser = authLimiter(AUTH_RATE_LIMITS.passwordChangeFailuresPerUser, {
        skipSuccessfulRequests: true,
        keyGenerator: (req) => `user:${(req as RequestWithContext).auth?.userId ?? ""}`,
    });

    const userRepository = new MongoUserRepository();
    const projectRepository = new MongoProjectRepository();
    const sessionRepository = new MongoSessionRepository();
    const platformConfigRepository = new MongoPlatformConfigRepository();

    const registerUser = new RegisterUser(userRepository);
    const loginUser = new LoginUser(userRepository, projectRepository, sessionRepository);
    const refreshSession = new RefreshSession(sessionRepository, userRepository);
    const changePassword = new ChangePassword(userRepository, sessionRepository);

    router.post("/register", registerPerIp, async (req, res, next) => {
        try {
            // Registration gate: superadmin can disable public self-registration
            const platformConfig = await platformConfigRepository.get();
            if (platformConfig && !platformConfig.registrationOpen) {
                res.status(403).json({ error: "Registration is currently closed" });
                return;
            }
            const result = await registerUser.execute(req.body);
            res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    });

    router.post("/login", loginPerIp, loginPerEmail, async (req, res, next) => {
        try {
            const result = await loginUser.execute(req.body, {
                ip: req.ip,
                userAgent: req.headers["user-agent"]
            });
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    });

    router.post("/refresh", refreshPerIp, async (req, res, next) => {
        try {
            const { refreshToken } = req.body;
            if (!refreshToken) {
                return res.status(400).json({ error: "Refresh token required" });
            }
            const result = await refreshSession.execute(refreshToken, {
                ip: req.ip,
                userAgent: req.headers["user-agent"]
            });
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    });

    router.post("/change-password", authMiddleware, passwordChangePerUser, async (req: RequestWithContext, res, next) => {
        try {
            const result = await changePassword.execute(req.auth!.userId, req.body);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
