import { Router } from "express";
import { RegisterUser } from "../../../application/use-cases/RegisterUser";
import { LoginUser } from "../../../application/use-cases/LoginUser";
import { RefreshSession } from "../../../application/use-cases/RefreshSession";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoSessionRepository } from "../../../infra/repositories/MongoSessionRepository";
import { MongoUserRepository } from "../../../infra/repositories/MongoUserRepository";

export function createAuthRoutes(): Router {
    const router = Router();

    const userRepository = new MongoUserRepository();
    const projectRepository = new MongoProjectRepository();
    const sessionRepository = new MongoSessionRepository();

    const registerUser = new RegisterUser(userRepository, projectRepository);
    const loginUser = new LoginUser(userRepository, projectRepository, sessionRepository);
    const refreshSession = new RefreshSession(sessionRepository);

    router.post("/register", async (req, res, next) => {
        try {
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
            const result = await refreshSession.execute(refreshToken);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
