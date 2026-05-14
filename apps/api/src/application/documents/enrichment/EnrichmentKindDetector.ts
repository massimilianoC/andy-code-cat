import type { EnrichmentAssetKind } from "../../../domain/entities/AssetEnrichmentTrace";

const PDF_MIMES = new Set(["application/pdf"]);
const DOCX_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
]);
const PLAIN_MIMES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
const HTML_MIMES = new Set(["text/html", "application/xhtml+xml"]);
const XLSX_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
]);
const PPTX_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
]);
const CSV_MIMES = new Set(["text/csv", "application/csv"]);
const CODE_TEXT_MIMES = new Set([
    "text/xml", "application/xml",
    "text/css",
    "text/javascript", "application/javascript",
    "application/json",
]);
const IMAGE_RASTER_MIMES = new Set([
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/tiff",
    // HEIC / HEIF (iPhone default) — converted to JPEG by ImageResizeGuard
    // before being sent to the vision LLM.
    "image/heic", "image/heif",
    // AVIF — modern web format with broad browser support.
    "image/avif",
]);
const IMAGE_SVG_MIMES = new Set(["image/svg+xml"]);

export function detectEnrichmentKind(mimeType: string): EnrichmentAssetKind {
    const mime = mimeType.toLowerCase().split(";")[0]!.trim();

    if (PDF_MIMES.has(mime)) return "pdf";
    if (DOCX_MIMES.has(mime)) return "docx";
    if (mime === "text/plain") return "txt";
    if (PLAIN_MIMES.has(mime)) return "md";
    if (HTML_MIMES.has(mime)) return "html";
    if (XLSX_MIMES.has(mime)) return "xlsx";
    if (CSV_MIMES.has(mime)) return "csv";
    if (PPTX_MIMES.has(mime)) return "pptx";
    if (CODE_TEXT_MIMES.has(mime)) return "txt";
    if (IMAGE_RASTER_MIMES.has(mime)) return "image_raster";
    if (IMAGE_SVG_MIMES.has(mime)) return "image_svg";
    return "unknown";
}

export function isDocumentKind(kind: EnrichmentAssetKind): boolean {
    return kind === "pdf" || kind === "docx" || kind === "txt" || kind === "md"
        || kind === "html" || kind === "xlsx" || kind === "csv" || kind === "pptx";
}

export function isImageKind(kind: EnrichmentAssetKind): boolean {
    return kind === "image_raster" || kind === "image_svg";
}
