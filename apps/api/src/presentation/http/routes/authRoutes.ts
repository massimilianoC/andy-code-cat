import { Router } from "express";
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

export function createAuthRoutes(): Router {
    const router = Router();

    const userRepository = new MongoUserRepository();
    const projectRepository = new MongoProjectRepository();
    const sessionRepository = new MongoSessionRepository();
    const platformConfigRepository = new MongoPlatformConfigRepository();

    const registerUser = new RegisterUser(userRepository, projectRepository);
    const loginUser = new LoginUser(userRepository, projectRepository, sessionRepository);
    const refreshSession = new RefreshSession(sessionRepository, userRepository);
    const changePassword = new ChangePassword(userRepository, sessionRepository);

    router.post("/register", async (req, res, next) => {
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

    router.post("/login", async (req, res, next) => {
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

    router.post("/refresh", async (req, res, next) => {
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

    router.post("/change-password", authMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const result = await changePassword.execute(req.auth!.userId, req.body);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
