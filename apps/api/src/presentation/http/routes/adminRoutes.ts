import { Router } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import { MongoUserRepository } from "../../../infra/repositories/MongoUserRepository";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoSiteDeploymentRepository } from "../../../infra/repositories/MongoSiteDeploymentRepository";
import { MongoPlatformConfigRepository } from "../../../infra/repositories/MongoPlatformConfigRepository";
import { ListUsers } from "../../../application/use-cases/admin/ListUsers";
import { GetUserDetail } from "../../../application/use-cases/admin/GetUserDetail";
import { BlockUser } from "../../../application/use-cases/admin/BlockUser";
import { SetUserRole } from "../../../application/use-cases/admin/SetUserRole";
import { AdminCreateUser } from "../../../application/use-cases/admin/AdminCreateUser";
import { SetUserLimits } from "../../../application/use-cases/admin/SetUserLimits";
import { DeleteUser } from "../../../application/use-cases/admin/DeleteUser";
import { GetPlatformStats } from "../../../application/use-cases/admin/GetPlatformStats";
import { GetPlatformConfig } from "../../../application/use-cases/admin/GetPlatformConfig";
import { SetPlatformConfig } from "../../../application/use-cases/admin/SetPlatformConfig";
import { AdminTogglePublication } from "../../../application/use-cases/admin/AdminTogglePublication";
import type { RequestWithContext } from "../types";

function getRequiredRouteParam(value: string | undefined, name: string): string {
    if (!value) {
        throw new Error(`Missing route parameter: ${name}`);
    }

    return value;
}

export function createAdminRoutes(): Router {
    const router = Router();

    // Repositories
    const userRepo = new MongoUserRepository();
    const projectRepo = new MongoProjectRepository();
    const deploymentRepo = new MongoSiteDeploymentRepository();
    const configRepo = new MongoPlatformConfigRepository();

    // Use-cases
    const listUsers = new ListUsers(userRepo);
    const getUserDetail = new GetUserDetail(userRepo, projectRepo);
    const blockUser = new BlockUser(userRepo);
    const setUserRole = new SetUserRole(userRepo);
    const adminCreateUser = new AdminCreateUser(userRepo, projectRepo);
    const setUserLimits = new SetUserLimits(userRepo);
    const deleteUser = new DeleteUser(userRepo);
    const getPlatformStats = new GetPlatformStats(userRepo, deploymentRepo);
    const getPlatformConfig = new GetPlatformConfig(configRepo);
    const setPlatformConfig = new SetPlatformConfig(configRepo);
    const adminTogglePublication = new AdminTogglePublication(deploymentRepo);

    // All admin routes require auth + superadmin role
    router.use(authMiddleware, requireSuperAdmin);

    // ── Stats ──────────────────────────────────────────────────────────────────
    router.get("/admin/stats", async (_req, res, next) => {
        try {
            const stats = await getPlatformStats.execute();
            res.json(stats);
        } catch (err) {
            next(err);
        }
    });

    // ── Platform config ────────────────────────────────────────────────────────
    router.get("/admin/config", async (_req, res, next) => {
        try {
            const config = await getPlatformConfig.execute();
            res.json(config);
        } catch (err) {
            next(err);
        }
    });

    router.patch("/admin/config", async (req: RequestWithContext, res, next) => {
        try {
            const updated = await setPlatformConfig.execute(req.auth!.userId, req.body);
            res.json(updated);
        } catch (err) {
            next(err);
        }
    });

    // ── User management ────────────────────────────────────────────────────────
    router.get("/admin/users", async (req, res, next) => {
        try {
            const result = await listUsers.execute(req.query);
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    router.post("/admin/users", async (req, res, next) => {
        try {
            const created = await adminCreateUser.execute(req.body);
            res.status(201).json(created);
        } catch (err) {
            next(err);
        }
    });

    router.get("/admin/users/:userId", async (req, res, next) => {
        try {
            const userId = getRequiredRouteParam(req.params.userId, "userId");
            const detail = await getUserDetail.execute(userId);
            res.json(detail);
        } catch (err) {
            next(err);
        }
    });

    router.patch("/admin/users/:userId/block", async (req: RequestWithContext, res, next) => {
        try {
            const userId = getRequiredRouteParam(req.params.userId, "userId");
            const result = await blockUser.execute(userId, req.auth!.userId, req.body);
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    router.patch("/admin/users/:userId/roles", async (req: RequestWithContext, res, next) => {
        try {
            const userId = getRequiredRouteParam(req.params.userId, "userId");
            const result = await setUserRole.execute(userId, req.auth!.userId, req.body);
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    router.patch("/admin/users/:userId/limits", async (req, res, next) => {
        try {
            const userId = getRequiredRouteParam(req.params.userId, "userId");
            const result = await setUserLimits.execute(userId, req.body);
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    router.delete("/admin/users/:userId", async (req: RequestWithContext, res, next) => {
        try {
            const userId = getRequiredRouteParam(req.params.userId, "userId");
            const result = await deleteUser.execute(userId, req.auth!.userId);
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    // ── Deployment/publication control ──────────────────────────────────────────
    router.get("/admin/deployments", async (req, res, next) => {
        try {
            const page = Math.max(1, Number(req.query.page) || 1);
            const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
            const result = await deploymentRepo.listAllPaginated(page, limit);
            res.json({
                deployments: result.deployments.map(d => ({
                    id: d.id,
                    publishId: d.publishId,
                    customSlug: d.customSlug ?? null,
                    projectId: d.projectId,
                    userId: d.userId,
                    status: d.status,
                    url: d.url,
                    isAdminBlocked: d.isAdminBlocked ?? false,
                    adminBlockedAt: d.adminBlockedAt?.toISOString() ?? null,
                    createdAt: d.createdAt.toISOString(),
                    updatedAt: d.updatedAt.toISOString(),
                })),
                total: result.total,
                page,
                limit,
            });
        } catch (err) {
            next(err);
        }
    });

    router.patch("/admin/deployments/:publishId/block", async (req: RequestWithContext, res, next) => {
        try {
            const publishId = getRequiredRouteParam(req.params.publishId, "publishId");
            const result = await adminTogglePublication.execute(
                publishId,
                req.auth!.userId,
                req.body,
            );
            res.json(result);
        } catch (err) {
            next(err);
        }
    });

    return router;
}
