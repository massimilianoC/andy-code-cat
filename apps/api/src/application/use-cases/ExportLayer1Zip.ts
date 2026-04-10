import archiver from "archiver";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import type { ExportRecord, AssetPlaceholder } from "../../domain/entities/ExportRecord";
import type { ExportRepository } from "../../domain/repositories/ExportRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import type { ConversationRepository } from "../../domain/repositories/ConversationRepository";
import type { Message } from "../../domain/entities/Conversation";
import type { LocalFileStorage } from "../../infra/storage/LocalFileStorage";
import { buildFullDoc, captureHtml } from "../../infra/capture/PuppeteerCaptureService";
import { env } from "../../config";

// ---------------------------------------------------------------------------
// Post-processor: separates inline CSS/JS from HTML artifacts
// ---------------------------------------------------------------------------
interface ProcessedArtifacts {
    html: string;
    css: string;
    js: string;
    placeholders: AssetPlaceholder[];
}

function extractInlineCss(html: string): { html: string; extracted: string } {
    const blocks: string[] = [];
    const cleaned = html.replace(/<style(?:[^>]*)>([\s\S]*?)<\/style>/gi, (_match, content: string) => {
        const trimmed = content.trim();
        if (trimmed) blocks.push(trimmed);
        return "";
    });
    return { html: cleaned, extracted: blocks.join("\n\n") };
}

function extractInlineJs(html: string): { html: string; extracted: string } {
    const blocks: string[] = [];
    // Only match <script> without a src attribute (inline scripts)
    const cleaned = html.replace(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi, (_match, content: string) => {
        const trimmed = content.trim();
        if (trimmed) blocks.push(trimmed);
        return "";
    });
    return { html: cleaned, extracted: blocks.join("\n\n") };
}

function ensureLinkTag(html: string): string {
    const linkTag = '<link rel="stylesheet" href="style.css">';
    if (html.includes('href="style.css"')) return html;
    return html.replace(/<\/head>/i, `  ${linkTag}\n</head>`);
}

function ensureScriptTag(html: string): string {
    const scriptTag = '<script src="script.js"></script>';
    if (html.includes('src="script.js"')) return html;
    return html.replace(/<\/body>/i, `  ${scriptTag}\n</body>`);
}

function detectPlaceholders(html: string, css: string): AssetPlaceholder[] {
    const placeholders: AssetPlaceholder[] = [];

    // Empty or placeholder-like img src
    const imgRe = /<img[^>]+src=["']([^"']*)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(html)) !== null) {
        const src = m[1];
        if (!src || /placeholder/i.test(src) || src.startsWith("data:") === false && src === "") {
            placeholders.push({
                path: `assets/placeholder-${placeholders.length + 1}.jpg`,
                usedIn: "<img> in HTML",
                recommendedSize: "1200x800px",
            });
        }
    }

    // CSS replace comments
    const replaceCommentRe = /\/\*\s*replace:\s*([^*]+)\*\//gi;
    while ((m = replaceCommentRe.exec(css)) !== null) {
        placeholders.push({
            path: `assets/replace-${placeholders.length + 1}`,
            usedIn: `CSS comment: ${m[1]!.trim()}`,
        });
    }

    // Empty url() in CSS
    const emptyUrlRe = /url\(["']?\s*["']?\)/gi;
    while ((m = emptyUrlRe.exec(css)) !== null) {
        placeholders.push({
            path: `assets/placeholder-${placeholders.length + 1}.jpg`,
            usedIn: "CSS url() empty value",
        });
    }

    // Deduplicate by path
    const seen = new Set<string>();
    return placeholders.filter((p) => {
        if (seen.has(p.path)) return false;
        seen.add(p.path);
        return true;
    });
}

function postProcess(artifacts: { html: string; css: string; js: string }): ProcessedArtifacts {
    let { html, css, js } = artifacts;

    // Extract inline blocks
    const { html: htmlNoCss, extracted: extractedCss } = extractInlineCss(html);
    html = htmlNoCss;
    const { html: htmlNoJs, extracted: extractedJs } = extractInlineJs(html);
    html = htmlNoJs;

    // Merge: artifact CSS/JS come first (they are "intentional" from LLM), then extracted
    css = [css.trim(), extractedCss].filter(Boolean).join("\n\n");
    js = [js.trim(), extractedJs].filter(Boolean).join("\n\n");

    // Ensure separated file references exist in HTML
    if (css.trim()) html = ensureLinkTag(html);
    if (js.trim()) html = ensureScriptTag(html);

    const placeholders = detectPlaceholders(html, css);

    return { html: html.trim(), css: css.trim(), js: js.trim(), placeholders };
}

// ---------------------------------------------------------------------------
// README generator
// ---------------------------------------------------------------------------

/**
 * Renders the chat history section for the README.
 * Shows only user prompts and assistant summaries — no artifacts, no raw JSON.
 */
function renderChatHistorySection(messages: Message[]): string {
    const relevant = messages.filter(
        (m) => m.role === "user" || m.role === "assistant"
    );
    if (relevant.length === 0) return "";

    const lines: string[] = ["## Storia della Conversazione", ""];
    let turnIndex = 0;

    for (const msg of relevant) {
        if (msg.role === "user") {
            turnIndex++;
            const ts = msg.timestamp
                ? new Date(msg.timestamp).toLocaleString("it-IT", {
                    dateStyle: "short",
                    timeStyle: "short",
                })
                : "";
            lines.push(`### ${turnIndex}. Prompt utente${ts ? ` — ${ts}` : ""}`);
            lines.push("");
            lines.push(msg.content.trim());
            lines.push("");
        } else {
            // assistant: prefer structured chat fields to avoid including raw artifacts in content
            const structured = (msg.metadata as (typeof msg.metadata) & {
                chatStructured?: { summary: string; bullets?: string[]; nextActions?: string[] };
            })?.chatStructured;

            lines.push(`#### Risposta agente`);
            lines.push("");

            if (structured) {
                lines.push(structured.summary.trim());
                if (structured.bullets?.length) {
                    lines.push("");
                    for (const b of structured.bullets) lines.push(`- ${b}`);
                }
                if (structured.nextActions?.length) {
                    lines.push("");
                    lines.push("**Prossimi passi suggeriti:**");
                    structured.nextActions.forEach((a, i) => lines.push(`${i + 1}. ${a}`));
                }
            } else {
                // content already is the formatted reply (summary + bullets from buildFormattedReply)
                lines.push(msg.content.trim());
            }
            lines.push("");
        }
    }

    return lines.join("\n");
}

function generateReadme(options: {
    projectName: string;
    exportId: string;
    snapshotId: string;
    placeholders: AssetPlaceholder[];
    filesIncluded: string[];
    chatMessages?: Message[];
}): string {
    const date = new Date().toISOString().slice(0, 10);
    const assetTable =
        options.placeholders.length === 0
            ? "_Nessun placeholder rilevato._"
            : [
                "| File | Usato in | Dimensioni consigliate |",
                "|---|---|---|",
                ...options.placeholders.map(
                    (p) => `| ${p.path} | ${p.usedIn} | ${p.recommendedSize ?? "—"} |`
                ),
            ].join("\n");

    const chatSection =
        options.chatMessages && options.chatMessages.length > 0
            ? `\n${renderChatHistorySection(options.chatMessages)}\n`
            : "";

    return `# ${options.projectName} — Export Andy Code Cat

**Data export:** ${date}
**Export ID:** ${options.exportId}
**Snapshot:** ${options.snapshotId}

## Deploy rapido

Apri \`index.html\` nel browser, oppure servi la cartella con:

\`\`\`bash
npx serve .
\`\`\`

Oppure su NGINX/Apache punta la root a questa cartella.

## Struttura

${options.filesIncluded.map((f) => `- \`${f}\``).join("\n")}

## Asset da sostituire

${assetTable}
${chatSection}
---

*Generato da [Andy Code Cat](https://andycodecat.io)*
`;
}

// ---------------------------------------------------------------------------
// ZIP builder — accepts string or Buffer entries
// ---------------------------------------------------------------------------
async function buildZip(
    zipPath: string,
    files: Record<string, string | Buffer>
): Promise<void> {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver("zip", { zlib: { level: 6 } });

        output.on("close", resolve);
        archive.on("error", reject);

        archive.pipe(output);

        for (const [filename, content] of Object.entries(files)) {
            if (Buffer.isBuffer(content)) {
                archive.append(content, { name: filename });
            } else {
                archive.append(content, { name: filename });
            }
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
export class ExportLayer1Zip {
    constructor(
        private readonly exportRepository: ExportRepository,
        private readonly snapshotRepository: PreviewSnapshotRepository,
        private readonly storage: LocalFileStorage,
        private readonly conversationRepository?: ConversationRepository
    ) { }

    async execute(input: {
        projectId: string;
        userId: string;
        projectName: string;
        snapshotId?: string;
        conversationId?: string;
    }): Promise<ExportRecord & { downloadToken: string; downloadUrl: string }> {
        // Resolve snapshot
        let snapshot;
        if (input.snapshotId) {
            snapshot = await this.snapshotRepository.findById(input.projectId, input.snapshotId);
        } else if (input.conversationId) {
            snapshot = await this.snapshotRepository.getActive(input.projectId, input.conversationId);
        }

        if (!snapshot) {
            throw Object.assign(
                new Error(
                    input.snapshotId
                        ? "Snapshot not found"
                        : "No active snapshot found for this project. Provide a snapshotId or conversationId."
                ),
                { statusCode: 404 }
            );
        }

        // Fetch conversation messages for README history (best-effort, non-blocking)
        let chatMessages: Message[] | undefined;
        if (input.conversationId && this.conversationRepository) {
            try {
                const conv = await this.conversationRepository.findById(
                    input.conversationId,
                    input.projectId
                );
                if (conv) chatMessages = conv.messages;
            } catch {
                // Non-critical: README will be generated without chat history
            }
        }

        // Post-process artifacts
        const processed = postProcess(snapshot.artifacts);

        const filesIncluded: string[] = ["index.html"];
        if (processed.css.trim()) filesIncluded.push("style.css");
        if (processed.js.trim()) filesIncluded.push("script.js");
        filesIncluded.push("preview-screenshot.jpg", "preview-screenshot.pdf", "README.md");

        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

        // Create pending record
        const record = await this.exportRepository.create({
            projectId: input.projectId,
            userId: input.userId,
            sourceType: "layer1_snapshot",
            snapshotId: snapshot.id,
            filesIncluded,
            assetPlaceholders: processed.placeholders,
            expiresAt,
        });

        try {
            const readme = generateReadme({
                projectName: input.projectName,
                exportId: record.id,
                snapshotId: snapshot.id,
                placeholders: processed.placeholders,
                filesIncluded,
                chatMessages,
            });

            // Build ZIP in memory-mapped temp path
            const zipDir = path.dirname(this.storage.exportZipPath(input.userId, input.projectId, record.id));
            await this.storage.ensureDir(zipDir);
            const zipPath = this.storage.exportZipPath(input.userId, input.projectId, record.id);

            // Capture JPG and PDF screenshots in parallel
            const captureHtmlDoc = buildFullDoc(
                snapshot.artifacts.html,
                snapshot.artifacts.css,
                snapshot.artifacts.js
            );
            const [captureJpg, capturePdf] = await Promise.all([
                captureHtml(captureHtmlDoc, "jpg").catch(() => null),
                captureHtml(captureHtmlDoc, "pdf").catch(() => null),
            ]);

            const files: Record<string, string | Buffer> = {
                "index.html": processed.html,
                "style.css": processed.css,
                "script.js": processed.js,
                "README.md": readme,
            };
            if (captureJpg) files["preview-screenshot.jpg"] = captureJpg;
            if (capturePdf) files["preview-screenshot.pdf"] = capturePdf;

            await buildZip(zipPath, files);

            const fileSize = await this.storage.fileSize(zipPath);
            const fileSha256 = await sha256OfFile(zipPath);

            const updated = await this.exportRepository.updateReady(record.id, { fileSize, fileSha256 });

            const ttl = env.EXPORT_DOWNLOAD_TTL;
            const downloadToken = jwt.sign(
                { sub: record.id, userId: input.userId, projectId: input.projectId },
                env.EXPORT_JWT_SECRET,
                { expiresIn: ttl as jwt.SignOptions["expiresIn"] }
            );

            const downloadUrl = `/v1/download/${downloadToken}`;

            return {
                ...(updated ?? record),
                filesIncluded,
                assetPlaceholders: processed.placeholders,
                downloadToken,
                downloadUrl,
            };
        } catch (err) {
            await this.exportRepository.updateFailed(record.id, String((err as Error).message));
            throw err;
        }
    }
}
