import { describe, it, expect } from "vitest";
import { getParser } from "../DocumentParserFactory";
import { detectEnrichmentKind, isDocumentKind } from "../../enrichment/EnrichmentKindDetector";

// Anti-drift guard: a document mime type must be recognized consistently across
// the parser factory and the kind detector (the two maps the enrichment pipeline
// itself depends on to run at all).
// See docs/specs/DOCUMENT_FORMAT_COVERAGE_EXTENSION_PLAN.md §2.4.
//
// Note: the upload allowlist (apps/api/src/application/use-cases/UploadProjectAsset.ts)
// is deliberately NOT covered here — importing it pulls in config.ts, which calls
// process.exit(1) when MONGODB_URI/JWT secrets are absent (the normal case for this
// unit-test process). That allowlist entry is verified manually instead (see plan §8).
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
});
