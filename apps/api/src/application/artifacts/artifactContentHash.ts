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
