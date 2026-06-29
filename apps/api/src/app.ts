import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config";
import { createHealthRoutes } from "./presentation/http/routes/healthRoutes";
import { createAuthRoutes } from "./presentation/http/routes/authRoutes";
import { createProjectRoutes } from "./presentation/http/routes/projectRoutes";
import { createConversationRoutes } from "./presentation/http/routes/conversationRoutes";
import { createLlmRoutes } from "./presentation/http/routes/llmRoutes";
import { createPreviewSnapshotRoutes } from "./presentation/http/routes/previewSnapshotRoutes";
import { createProjectAssetRoutes } from "./presentation/http/routes/projectAssetRoutes";
import { createExportRoutes } from "./presentation/http/routes/exportRoutes";
import { createGenerationWorkspaceRoutes } from "./presentation/http/routes/generationWorkspaceRoutes";
import { createWysiwygRoutes } from "./presentation/http/routes/wysiwygRoutes";
import { createExecutionLogRoutes } from "./presentation/http/routes/executionLogRoutes";
import { createPublishRoutes } from "./presentation/http/routes/publishRoutes";
import { createPublicMediaRoutes } from "./presentation/http/routes/publicMediaRoutes";
import { createUserProfileRoutes } from "./presentation/http/routes/userProfileRoutes";
import { createPresetRoutes } from "./presentation/http/routes/presetRoutes";
import { errorHandler } from "./presentation/http/middlewares/errorHandler";
import { createAdminRoutes } from "./presentation/http/routes/adminRoutes";
import { createPipelineRoutes } from "./presentation/http/routes/pipelineRoutes";
import { createCostRoutes } from "./presentation/http/routes/costRoutes";
import { createVibecoreRoutes } from "./presentation/http/routes/vibecoreRoutes";
import { createNotificationRoutes } from "./presentation/http/routes/notificationRoutes";
import { createDatasetRoutes } from "./presentation/http/routes/datasetRoutes";
import { createDidacticRoutes } from "./presentation/http/routes/didacticRoutes";

export function createApp() {
    const app = express();

    // Trust the first proxy hop (nginx) so req.ip reflects the real client IP.
    app.set("trust proxy", 1);

    // Restrict CORS to the configured origin(s); default is "*" for local dev.
    // Keep requests without Origin (health checks, curl, server-side probes) allowed.
    const allowedOrigins = env.CORS_ORIGIN === "*"
        ? "*"
        : env.CORS_ORIGIN.split(",").map(o => o.trim()).filter(Boolean);

    const corsOptions: cors.CorsOptions = {
        origin: (origin, callback) => {
            if (!origin || allowedOrigins === "*" || allowedOrigins.includes(origin)) {
                callback(null, true);
                return;
            }
            callback(null, false);
        },
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "x-project-id"],
        optionsSuccessStatus: 204,
    };

    app.use(helmet());
    app.use(cors(corsOptions));
    app.options("*", cors(corsOptions));
    app.use(express.json({ limit: "8mb" }));
    app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

    // Publish routes are created up-front so the PUBLIC check-slug router can be
    // mounted before any router that applies a global authMiddleware. The auth-protected
    // apiRouter and the static /p router are mounted later, at their normal positions.
    const { apiRouter: publishApi, staticRouter: publishStatic, publicRouter: publishPublic } = createPublishRoutes();

    app.use("/", createHealthRoutes());
    app.use("/v1/auth", createAuthRoutes());
    // Presets catalog — public, no auth (must be before any router that applies authMiddleware)
    app.use("/v1", createPresetRoutes());
    // Public slug availability check — no auth. MUST be before the auth-applying routers
    // below, otherwise their router.use(authMiddleware) intercepts it with a 401.
    app.use("/v1", publishPublic);
    // User profile + style tags (public /v1/style-tags must come before route groups
    // that apply global authMiddleware, otherwise the public route is blocked)
    app.use("/v1", createUserProfileRoutes());
    app.use("/v1", createProjectRoutes());
    app.use("/v1", createConversationRoutes());
    app.use("/v1", createLlmRoutes());
    app.use("/v1", createPreviewSnapshotRoutes());
    app.use("/v1", createProjectAssetRoutes());
    app.use("/v1", createExportRoutes());
    app.use("/v1", createGenerationWorkspaceRoutes());
    app.use("/v1", createPipelineRoutes());
    app.use("/v1", createWysiwygRoutes());
    app.use("/v1", createExecutionLogRoutes());
    app.use("/v1", createCostRoutes());
    app.use("/v1", createVibecoreRoutes());
    app.use("/v1", createNotificationRoutes());
    app.use("/v1", createDidacticRoutes());
    app.use("/v1", createDatasetRoutes());

    // Public media serving must be mounted before publish static routes.
    // Otherwise /p/media/:assetId is swallowed by /p/:publishId/:file.
    app.use("/p", createPublicMediaRoutes());

    // Publish: API routes (auth-protected) + static serving (public).
    // publishPublic (check-slug) was already mounted above, before the auth routers.
    app.use("/v1", publishApi);
    app.use("/p", publishStatic);

    // Super admin routes — auth + requireSuperAdmin guard applied inside the router
    app.use("/v1", createAdminRoutes());

    app.use(errorHandler);

    return app;
}
