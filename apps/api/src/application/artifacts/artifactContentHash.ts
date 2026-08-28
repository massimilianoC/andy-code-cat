import { createHash } from "node:crypto";
import type { PreviewSnapshotArtifacts } from "../../domain/entities/PreviewSnapshot";

/**
 * AL-039 — the certification primitive for an artifact version.
 *
 * Same shape as `CanonicalBriefEnvelope.contentHash` (buildCanonicalGenerationBrief.ts):
 * sha256 over content, lowercase hex. That hash certifies "the text this run froze is the
 * text that reached the model"; this one certifies "the artifact you edited is the artifact
 * I stored".
 *
 * Hashed over the CANONICAL artifacts — what goes into the database — never over what the
 * API returns. The read paths compile forms and inline-preview runtime into the html before
 * responding (prepareArtifactServices), so a hash taken from a response body would differ
 * from the stored one on every single version and certify nothing. This is why the client
 * echoes the server's hash back instead of computing its own.
 *
 * The three fields are length-prefixed so no combination of contents can be rearranged into
 * another: "<a>" + "" and "" + "<a>" must not collide.
 */
export function computeArtifactContentHash(artifacts: PreviewSnapshotArtifacts): string {
    const hash = createHash("sha256");
    hash.update("artifact-content-v1");
    for (const part of [artifacts.html ?? "", artifacts.css ?? "", artifacts.js ?? ""]) {
        hash.update(`\n${part.length}\n`);
        hash.update(part);
    }
    return hash.digest("hex");
}

/**
 * AL-045 — the line-ending form of an artifact is not content.
 *
 * A browser textarea and Monaco both hand back CRLF on Windows, so an artifact saved from
 * the code editor without a single keystroke differed from the stored one by nothing but
 * `\r`. That was enough to change its hash, which made every first save after opening the
 * editor look like a real change and added a version nobody asked for. Observed live:
 * an unedited "Salva versione" answered 201 instead of 200.
 *
 * Canonicalised on the way in, so the stored artifact and the hash that certifies it agree
 * and a later save of that same artifact compares equal.
 */
export function canonicaliseArtifacts(artifacts: PreviewSnapshotArtifacts): PreviewSnapshotArtifacts {
    return {
        html: (artifacts.html ?? "").replace(/\r\n/g, "\n"),
        css: (artifacts.css ?? "").replace(/\r\n/g, "\n"),
        js: (artifacts.js ?? "").replace(/\r\n/g, "\n"),
    };
}
