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
import { createUserProfileRoutes } from "./presentation/http/routes/userProfileRoutes";
import { createPresetRoutes } from "./presentation/http/routes/presetRoutes";
import { errorHandler } from "./presentation/http/middlewares/errorHandler";

export function createApp() {
    const app = express();

    // Trust the first proxy hop (nginx) so req.ip reflects the real client IP.
    app.set("trust proxy", 1);

    // Restrict CORS to the configured origin(s); default is "*" for local dev.
    const corsOrigin = env.CORS_ORIGIN === "*"
        ? "*"
        : env.CORS_ORIGIN.split(",").map(o => o.trim());

    app.use(helmet());
    app.use(cors({ origin: corsOrigin }));
    app.use(express.json({ limit: "1mb" }));
    app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

    app.use("/", createHealthRoutes());
    app.use("/v1/auth", createAuthRoutes());
    // Presets catalog — public, no auth (must be before any router that applies authMiddleware)
    app.use("/v1", createPresetRoutes());
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
    app.use("/v1", createWysiwygRoutes());
    app.use("/v1", createExecutionLogRoutes());

    // Publish: API routes (auth-protected) + static serving (public)
    const { apiRouter: publishApi, staticRouter: publishStatic } = createPublishRoutes();
    app.use("/v1", publishApi);
    app.use("/p", publishStatic);

    app.use(errorHandler);

    return app;
}
