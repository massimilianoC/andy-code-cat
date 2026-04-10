import fs from "fs/promises";
import path from "path";
import type { GenerationWorkspace, WorkspaceFile } from "../../domain/entities/GenerationWorkspace";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { LocalFileStorage } from "../../infra/storage/LocalFileStorage";

/**
 * PrepareGenerationWorkspace — assembles everything OpenCode needs before it runs.
 *
 * Inputs gathered:
 *  1. All project assets (user uploads + platform-generated) → input/assets/
 *  2. Layer 1 snapshot artifacts (HTML/CSS/JS)              → input/layer1/
 *  3. Conversation brief (user messages formatted as md)    → input/brief.md
 *  4. MANIFEST.json                                         → workspace root
 *
 * The caller (M3 GenerationWorker) provides a jobId so the workspace is uniquely
 * scoped at /data/workspaces/{userId}/{projectId}/{jobId}/.
 *
 * This use-case is callable both from HTTP and from other use-cases/workers —
 * it has no HTTP-specific dependencies.
 */
export class PrepareGenerationWorkspace {
    constructor(
        private readonly assetRepository: ProjectAssetRepository,
        private readonly snapshotRepository: PreviewSnapshotRepository,
        private readonly conversationRepository: ConversationRepository,
        private readonly storage: LocalFileStorage
    ) { }

    async execute(input: {
        userId: string;
        projectId: string;
        /** Unique identifier for the generation job (provided by M3 Job entity). */
        jobId: string;
        /** If provided, use this conversation for brief + snapshot lookup. */
        conversationId?: string;
        /** If provided, use this specific snapshot for Layer 1 artifacts. Falls back to active snapshot for conversationId. */
        snapshotId?: string;
    }): Promise<GenerationWorkspace> {
        const { userId, projectId, jobId, conversationId, snapshotId } = input;

        const wsRoot = this.storage.workspacePath(userId, projectId, jobId);
        const inputPath = this.storage.workspaceInputPath(userId, projectId, jobId);
        const assetsPath = this.storage.workspaceInputAssetsPath(userId, projectId, jobId);
        const layer1Path = this.storage.workspaceInputLayer1Path(userId, projectId, jobId);
        const outputPath = this.storage.workspaceOutputPath(userId, projectId, jobId);
        const logsPath = this.storage.workspaceLogsPath(userId, projectId, jobId);

        // Create all workspace dirs up front
        await Promise.all([
            this.storage.ensureDir(assetsPath),
            this.storage.ensureDir(layer1Path),
            this.storage.ensureDir(outputPath),
            this.storage.ensureDir(logsPath),
        ]);

        const files: WorkspaceFile[] = [];
        let layer1Included = false;
        let briefPath: string | undefined;
        let usedSnapshotId: string | undefined;

        // ----------------------------------------------------------------
        // 1. Copy all project assets (user uploads + platform-generated)
        // ----------------------------------------------------------------
        const assets = await this.assetRepository.listByProject(projectId, userId);
        for (const asset of assets) {
            const src = this.storage.uploadFilePath(userId, projectId, asset.storedFilename);
            const destRelative = path.join("input", "assets", asset.storedFilename);
            try {
                await this.storage.copyToWorkspace(src, wsRoot, destRelative);
                files.push({
                    relativePath: destRelative,
                    source: asset.source === "platform_generated" ? "platform_asset" : "user_asset",
                    mimeType: asset.mimeType,
                    assetId: asset.id,
                });
            } catch {
                // Asset file missing on disk — skip gracefully, log is implicit via missing file
            }
        }

        // ----------------------------------------------------------------
        // 2. Layer 1 snapshot artifacts → input/layer1/{index,style,script}.{html,css,js}
        // ----------------------------------------------------------------
        let snapshot = null;

        if (snapshotId) {
            snapshot = await this.snapshotRepository.findById(projectId, snapshotId);
        } else if (conversationId) {
            snapshot = await this.snapshotRepository.getActive(projectId, conversationId);
        }

        if (snapshot) {
            usedSnapshotId = snapshot.id;
            const artifactFiles: Array<{ name: string; content: string; mime: string }> = [
                { name: "index.html", content: snapshot.artifacts.html, mime: "text/html" },
                { name: "style.css", content: snapshot.artifacts.css, mime: "text/css" },
                { name: "script.js", content: snapshot.artifacts.js, mime: "application/javascript" },
            ];
            for (const artifact of artifactFiles) {
                if (!artifact.content.trim()) continue;
                const rel = path.join("input", "layer1", artifact.name);
                await this.storage.writeWorkspaceFile(wsRoot, rel, artifact.content);
                files.push({ relativePath: rel, source: "layer1_artifact", mimeType: artifact.mime });
            }
            layer1Included = true;
        }

        // ----------------------------------------------------------------
        // 3. Brief — auto-generated from user messages in the conversation
        // ----------------------------------------------------------------
        if (conversationId) {
            const conversation = await this.conversationRepository.findById(conversationId, projectId);
            if (conversation && conversation.messages.length > 0) {
                const brief = buildBrief(conversation.messages.filter((m) => m.role === "user").map((m) => ({ content: m.content, timestamp: m.timestamp })));
                if (brief.trim()) {
                    const briefRel = path.join("input", "brief.md");
                    briefPath = await this.storage.writeWorkspaceFile(wsRoot, briefRel, brief);
                    files.push({ relativePath: briefRel, source: "generated", mimeType: "text/markdown" });
                }
            }
        }

        // ----------------------------------------------------------------
        // 4. MANIFEST.json
        // ----------------------------------------------------------------
        const manifest: GenerationWorkspace = {
            jobId,
            userId,
            projectId,
            rootPath: wsRoot,
            inputPath,
            outputPath,
            logsPath,
            files,
            layer1Included,
            briefPath,
            snapshotId: usedSnapshotId,
            createdAt: new Date(),
        };
        await this.storage.writeWorkspaceFile(
            wsRoot,
            "MANIFEST.json",
            JSON.stringify(manifest, null, 2)
        );
        files.push({ relativePath: "MANIFEST.json", source: "generated", mimeType: "application/json" });

        return manifest;
    }
}

// ---------------------------------------------------------------------------
// Brief builder: formats user chat messages into a clean markdown document
// ---------------------------------------------------------------------------

function buildBrief(userMessages: Array<{ content: string; timestamp: Date }>): string {
    const lines: string[] = [
        "# Project Brief",
        "",
        "> Auto-generated from conversation history. Use as requirements context for OpenCode.",
        "",
        "## User Requirements",
        "",
    ];

    userMessages.forEach((msg, i) => {
        lines.push(`### ${i + 1}. ${msg.timestamp.toISOString()}`);
        lines.push("");
        lines.push(msg.content.trim());
        lines.push("");
    });

    return lines.join("\n");
}
