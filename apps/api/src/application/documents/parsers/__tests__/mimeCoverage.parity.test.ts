import { describe, it, expect } from "vitest";
import { getParser } from "../DocumentParserFactory";
import { detectEnrichmentKind, isDocumentKind } from "../../enrichment/EnrichmentKindDetector";

// UploadProjectAsset.ts imports config.ts, which validates required env vars at module
// load time (process.exit(1) if missing). Same pattern as promptTraceParity.test.ts /
// PublishExportMediaGuardrails.test.ts: stub the minimum required config here, then reach
// the module through a dynamic import so these assignments run first.
process.env.MONGODB_URI ??= "mongodb://localhost:27017/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";

async function loadIsAllowedMime() {
    const { isAllowedMime } = await import("../../../use-cases/UploadProjectAsset");
    return isAllowedMime;
}

// Anti-drift guard: a document mime type must be recognized consistently across all three
// server-side maps (parser factory, kind detector, upload allowlist).
// See docs/specs/DOCUMENT_FORMAT_COVERAGE_EXTENSION_PLAN.md §2.4.
const DOCUMENT_MIMES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/rtf",
    "text/rtf",
    "application/vnd.oasis.opendocument.text",
    "text/plain",
    "text/markdown",
    "text/html",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

describe("document mime coverage parity", () => {
    it.each(DOCUMENT_MIMES)("%s has a parser, a known kind, and is a document kind", (mime) => {
        expect(getParser(mime)).not.toBeNull();
        const kind = detectEnrichmentKind(mime);
        expect(kind).not.toBe("unknown");
        expect(isDocumentKind(kind)).toBe(true);
    });

    it.each(DOCUMENT_MIMES)("%s is accepted by the upload allowlist", async (mime) => {
        const isAllowedMime = await loadIsAllowedMime();
        expect(isAllowedMime(mime)).toBe(true);
    });
});
