import { Router } from "express";
import rateLimit from "express-rate-limit";
import { listSystemNotificationsQuerySchema } from "@andy-code-cat/contracts";
import { MongoSystemNotificationRepository } from "../../../infra/repositories/MongoSystemNotificationRepository";
import { SystemNotifier } from "../../../application/services/SystemNotifier";
import { authMiddleware } from "../middlewares/authMiddleware";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import type { RequestWithContext } from "../types";
import type { SystemNotification } from "../../../domain/entities/SystemNotification";

function toDto(notification: SystemNotification) {
    return {
        ...notification,
        createdAt: notification.createdAt.toISOString(),
        readAt: notification.readAt?.toISOString(),
    };
}

export function createNotificationRoutes(): Router {
    const router = Router();
    const repository = new MongoSystemNotificationRepository();
    SystemNotifier.configure(repository);
    const notificationReadLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 120,
        standardHeaders: true,
        legacyHeaders: false,
    });
    const notificationWriteLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 60,
        standardHeaders: true,
        legacyHeaders: false,
    });

    router.get("/notifications", notificationReadLimiter, authMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const query = listSystemNotificationsQuerySchema.parse(req.query);
            const notifications = await repository.listForUser(req.auth!.userId, query);
            res.json({ notifications: notifications.map(toDto) });
        } catch (error) {
            next(error);
        }
    });

    router.patch("/notifications/:id/read", notificationWriteLimiter, authMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const notification = await repository.markRead(req.params.id!, req.auth!.userId);
            if (!notification) {
                res.status(404).json({ error: "Notification not found" });
                return;
            }
            res.json({ notification: toDto(notification) });
        } catch (error) {
            next(error);
        }
    });

    router.get("/admin/notifications", notificationReadLimiter, authMiddleware, requireSuperAdmin, async (req, res, next) => {
        try {
            const query = listSystemNotificationsQuerySchema.parse(req.query);
            const notifications = await repository.listForAdmin(query);
            res.json({ notifications: notifications.map(toDto) });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
