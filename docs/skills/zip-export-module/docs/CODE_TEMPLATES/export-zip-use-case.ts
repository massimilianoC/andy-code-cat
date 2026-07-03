/**
 * Example export use case wiring ZIP assembly, persistence, and the signed
 * download token on top of post-processor.ts.
 *
 * This file is illustrative, not literally importable — replace the
 * `yourFileStorage` / `yourExportRepository` / `yourArtifactSource` stand-ins
 * with whatever your project already has. Do NOT invent a new storage layer
 * or DB model just for this feature.
 *
 * npm dependencies: archiver, jsonwebtoken
 */
import archiver from "archiver";
import crypto from "crypto";
import fs from "fs";
import jwt from "jsonwebtoken";
import { postProcess, generateReadme, type Artifacts, type AssetPlaceholder } from "./post-processor";

// ---- Stand-ins — replace with your real implementations -------------------

declare const yourFileStorage: {
    /** Must be a pure function of server-verified IDs — never raw request input. */
    exportZipPath(userId: string, projectId: string, exportId: string): string;
    ensureDir(dirPath: string): Promise<void>;
    fileExists(filePath: string): Promise<boolean>;
    fileSize(filePath: string): Promise<number>;
};

type ExportStatus = "pending" | "ready" | "failed";

interface ExportRecord {
    id: string;
    projectId: string;
    userId: string;
    status: ExportStatus;
    fileSize?: number;
    fileSha256?: string;
    filesIncluded: string[];
    assetPlaceholders: AssetPlaceholder[];
    expiresAt: Date;
    errorMessage?: string;
    createdAt: Date;
    readyAt?: Date;
}

declare const yourExportRepository: {
    create(input: {
        projectId: string;
        userId: string;
        filesIncluded: string[];
        assetPlaceholders: AssetPlaceholder[];
        expiresAt: Date;
    }): Promise<ExportRecord>;
    updateReady(id: string, data: { fileSize: number; fileSha256: string }): Promise<ExportRecord | null>;
    updateFailed(id: string, errorMessage: string): Promise<void>;
};

declare const yourArtifactSource: {
    /** Resolve "the current agent output" for this project — snapshot, last message, editor buffer, etc. */
    getCurrentArtifacts(projectId: string): Promise<Artifacts | null>;
};

// Set this at boot. NEVER reuse your session/auth JWT secret here — see AGENTS.md §2.
const EXPORT_JWT_SECRET = process.env.EXPORT_JWT_SECRET!;
const EXPORT_TOKEN_TTL = "1h";
const EXPORT_RECORD_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ---------------------------------------------------------------------------
// ZIP builder — accepts both string and Buffer entries so optional binary
// assets (e.g. a preview screenshot) slot in the same way as text files.
// ---------------------------------------------------------------------------
async function buildZip(zipPath: string, files: Record<string, string | Buffer>): Promise<void> {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver("zip", { zlib: { level: 6 } });
        output.on("close", resolve);
        archive.on("error", reject);
        archive.pipe(output);
        for (const [filename, content] of Object.entries(files)) {
            archive.append(content, { name: filename });
        }
        archive.finalize();
    });
}

async function sha256OfFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);
        stream.on("data", (d) => hash.update(d));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
    });
}

// ---------------------------------------------------------------------------
// Use case
// ---------------------------------------------------------------------------
export interface ExportInput {
    projectId: string;
    userId: string;
    projectName: string;
}

export interface ExportResult extends ExportRecord {
    downloadToken: string;
    downloadUrl: string;
}

export async function exportProjectAsZip(input: ExportInput): Promise<ExportResult> {
    const artifacts = await yourArtifactSource.getCurrentArtifacts(input.projectId);
    if (!artifacts) {
        throw Object.assign(new Error("No exportable output found for this project."), { statusCode: 404 });
    }

    // If your project has an "async-generation still pending" concept, assert it
    // here BEFORE post-processing runs. See docs/ARCHITECTURE.md § Blocking gate.
    // assertNoUnresolvedPlaceholders(artifacts);

    const processed = postProcess(artifacts);

    const filesIncluded: string[] = ["index.html"];
    if (processed.css.trim()) filesIncluded.push("style.css");
    if (processed.js.trim()) filesIncluded.push("script.js");
    filesIncluded.push("README.md");

    const expiresAt = new Date(Date.now() + EXPORT_RECORD_TTL_MS);

    const record = await yourExportRepository.create({
        projectId: input.projectId,
        userId: input.userId,
        filesIncluded,
        assetPlaceholders: processed.placeholders,
        expiresAt,
    });

    try {
        const readme = generateReadme({
            projectName: input.projectName,
            exportId: record.id,
            placeholders: processed.placeholders,
            filesIncluded,
        });

        const zipPath = yourFileStorage.exportZipPath(input.userId, input.projectId, record.id);
        await yourFileStorage.ensureDir(zipPath.replace(/[^/\\]+$/, ""));

        const files: Record<string, string | Buffer> = {
            "index.html": processed.html,
            "README.md": readme,
        };
        if (processed.css.trim()) files["style.css"] = processed.css;
        if (processed.js.trim()) files["script.js"] = processed.js;
        // Optional: embed a preview screenshot/PDF here via the companion
        // screenshot-pdf-export skill's captureForExport() — wrap in try/catch,
        // never let a capture failure abort the export.

        await buildZip(zipPath, files);

        const fileSize = await yourFileStorage.fileSize(zipPath);
        const fileSha256 = await sha256OfFile(zipPath);
        const updated = await yourExportRepository.updateReady(record.id, { fileSize, fileSha256 });

        const downloadToken = jwt.sign(
            { sub: record.id, userId: input.userId, projectId: input.projectId },
            EXPORT_JWT_SECRET,
            { expiresIn: EXPORT_TOKEN_TTL }
        );

        return {
            ...(updated ?? record),
            filesIncluded,
            assetPlaceholders: processed.placeholders,
            downloadToken,
            downloadUrl: `/download/${downloadToken}`,
        };
    } catch (err) {
        await yourExportRepository.updateFailed(record.id, String((err as Error).message));
        throw err;
    }
}
