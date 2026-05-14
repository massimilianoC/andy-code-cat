/**
 * Cost routes — project cost summary, transaction list, user cost, admin dashboard.
 *
 * Route map:
 *   GET  /v1/projects/:projectId/cost              → project cost summary + breakdown
 *   GET  /v1/projects/:projectId/cost/transactions → paginated ledger for the project
 *   GET  /v1/users/me/cost                         → authenticated user cost summary
 *   GET  /v1/admin/cost/dashboard                  → platform-wide dashboard (superadmin)
 *   GET  /v1/admin/cost/transactions               → all transactions (superadmin, filterable)
 *   PATCH /v1/admin/cost/rates                     → update PlatformConfig.costRates (superadmin)
 */

import { Router } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { createSandboxMiddleware } from "../middlewares/sandboxMiddleware";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import type { RequestWithContext } from "../middlewares/authMiddleware";
import { MongoProjectRepository } from "../../../infra/repositories/MongoProjectRepository";
import { MongoCostTransactionRepository } from "../../../infra/repositories/MongoCostTransactionRepository";
import { MongoPlatformConfigRepository } from "../../../infra/repositories/MongoPlatformConfigRepository";
import { CostTransactionService } from "../../../application/cost/CostTransactionService";

export function createCostRoutes(): Router {
    const router = Router();
    const projectRepository = new MongoProjectRepository();
    const costRepo = new MongoCostTransactionRepository();
    const platformConfigRepo = new MongoPlatformConfigRepository();
    const sandboxMiddleware = createSandboxMiddleware(projectRepository);

    router.use(authMiddleware);

    // ─────────────────────────────────────────────────────────────────────
    // Project cost summary (project member via sandbox)
    // ─────────────────────────────────────────────────────────────────────
    router.get("/projects/:projectId/cost", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const projectId = req.sandbox!.projectId;
            const [summary, breakdown, trend] = await Promise.all([
                costRepo.sumByProject(projectId),
                costRepo.breakdownByTypeForProject(projectId),
                costRepo.trendByProject(projectId, 30),
            ]);
            res.json({ summary, breakdown, trend });
        } catch (error) {
            next(error);
        }
    });

    // ─────────────────────────────────────────────────────────────────────
    // Project cost transaction list (paginated)
    // ─────────────────────────────────────────────────────────────────────
    router.get("/projects/:projectId/cost/transactions", sandboxMiddleware, async (req: RequestWithContext, res, next) => {
        try {
            const projectId = req.sandbox!.projectId;
            const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
            const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
            const result = await costRepo.listByProject(projectId, { page, limit });
            res.json(result);
        } catch (error) {
            next(error);
        }
    });

    // ─────────────────────────────────────────────────────────────────────
    // Authenticated user cost summary
    // ─────────────────────────────────────────────────────────────────────
    router.get("/users/me/cost", async (req: RequestWithContext, res, next) => {
        try {
            const userId = req.auth!.userId;
            const [summary, breakdown, trend, topProjects] = await Promise.all([
                costRepo.sumByUser(userId),
                costRepo.breakdownByTypeForUser(userId),
                costRepo.trendByUser(userId, 30),
                costRepo.topProjectsByUser(userId, 10),
            ]);
            res.json({ summary, breakdown, trend, topProjects });
        } catch (error) {
            next(error);
        }
    });

    // ─────────────────────────────────────────────────────────────────────
    // Admin: platform-wide dashboard (superadmin only)
    // ─────────────────────────────────────────────────────────────────────
    router.get("/admin/cost/dashboard", requireSuperAdmin, async (req: RequestWithContext, res, next) => {
        try {
            const fromParam = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
            const toParam = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
            const from = fromParam && !isNaN(fromParam.getTime()) ? fromParam : undefined;
            const to = toParam && !isNaN(toParam.getTime()) ? toParam : undefined;

            const [breakdown, trend, topProjects, platformConfig] = await Promise.all([
                costRepo.breakdownByTypePlatform(from, to),
                costRepo.trendPlatform(30),
                costRepo.topProjectsPlatform(from, to, 20),
                platformConfigRepo.get(),
            ]);

            // Derive platform summary totals by aggregating the breakdown rows
            const platformSummary = breakdown.reduce(
                (acc, row) => {
                    acc.totalEur += row.totalEur;
                    acc.providerCostEur += row.providerCostEur;
                    acc.infraCostEur += row.infraCostEur;
                    acc.platformMarkupEur += row.platformMarkupEur;
                    acc.txCount += row.txCount;
                    return acc;
                },
                { totalEur: 0, providerCostEur: 0, infraCostEur: 0, platformMarkupEur: 0, txCount: 0 }
            );

            res.json({
                summary: platformSummary,
                breakdown,
                trend,
                topProjects,
                currentRates: platformConfig?.costRates ?? null,
            });
        } catch (error) {
            next(error);
        }
    });

    // ─────────────────────────────────────────────────────────────────────
    // Admin: full transaction ledger (superadmin only, filterable + paginated)
    // ─────────────────────────────────────────────────────────────────────
    router.get("/admin/cost/transactions", requireSuperAdmin, async (req: RequestWithContext, res, next) => {
        try {
            const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
            const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
            const fromParam = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
            const toParam = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;

            const result = await costRepo.listAll(
                {
                    userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
                    projectId: typeof req.query.projectId === "string" ? req.query.projectId : undefined,
                    resourceType: typeof req.query.resourceType === "string" ? req.query.resourceType : undefined,
                    status: req.query.status === "voided" ? "voided" : req.query.status === "settled" ? "settled" : undefined,
                    fromDate: fromParam && !isNaN(fromParam.getTime()) ? fromParam : undefined,
                    toDate: toParam && !isNaN(toParam.getTime()) ? toParam : undefined,
                },
                { page, limit },
            );
            res.json(result);
        } catch (error) {
            next(error);
        }
    });

    // ─────────────────────────────────────────────────────────────────────
    // Admin: update platform cost rates (superadmin only)
    // ─────────────────────────────────────────────────────────────────────
    router.patch("/admin/cost/rates", requireSuperAdmin, async (req: RequestWithContext, res, next) => {
        try {
            const body = req.body as Record<string, unknown>;
            const allowed = [
                "usdToEurRate",
                "platformMarkupPct",
                "infraCostPct",
                "textEurPer1kTokens",
                "imageEurPerAsset",
                "videoEurPerAsset",
                "computeEurPerMs",
                "storageEurPerGbMonth",
            ];
            const rates: Record<string, unknown> = {};
            for (const key of allowed) {
                if (typeof body[key] === "number") rates[key] = body[key];
            }

            // Handle perType policies — validate and sanitise each type entry
            if (body.perType !== null && typeof body.perType === "object" && !Array.isArray(body.perType)) {
                const perType: Record<string, unknown> = {};
                const policyNumericKeys = ["markupPct", "infraPct", "fixedFeeEur", "tokenRateEurPer1k", "assetRateEur"];
                for (const [typeKey, policyRaw] of Object.entries(body.perType as Record<string, unknown>)) {
                    if (typeof policyRaw !== "object" || policyRaw === null) continue;
                    const policy = policyRaw as Record<string, unknown>;
                    const clean: Record<string, unknown> = {};
                    for (const pk of policyNumericKeys) {
                        if (typeof policy[pk] === "number") clean[pk] = policy[pk];
                    }
                    if (typeof policy.useProviderCost === "boolean") clean.useProviderCost = policy.useProviderCost;
                    if (typeof policy.note === "string") clean.note = String(policy.note).slice(0, 200);
                    if (Object.keys(clean).length > 0) perType[typeKey] = clean;
                }
                if (Object.keys(perType).length > 0) rates.perType = perType;
            }

            if (Object.keys(rates).length === 0) {
                res.status(400).json({ error: "No valid rate fields provided" });
                return;
            }

            const updated = await platformConfigRepo.upsert({
                costRates: { ...rates, updatedByUserId: req.auth!.userId } as Parameters<typeof platformConfigRepo.upsert>[0]["costRates"],
                updatedByUserId: req.auth!.userId,
            });

            // Bust the CostTransactionService rate cache so updated rates apply immediately
            CostTransactionService.instance.invalidateRatesCache();

            res.json({ costRates: updated.costRates });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
