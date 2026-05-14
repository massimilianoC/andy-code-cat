import type { EnrichmentAssetKind } from "../../../domain/entities/AssetEnrichmentTrace";

const PDF_MIMES = new Set(["application/pdf"]);
const DOCX_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
]);
const PLAIN_MIMES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
const IMAGE_RASTER_MIMES = new Set([
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/tiff",
]);
const IMAGE_SVG_MIMES = new Set(["image/svg+xml"]);

export function detectEnrichmentKind(mimeType: string): EnrichmentAssetKind {
    const mime = mimeType.toLowerCase().split(";")[0]!.trim();

    if (PDF_MIMES.has(mime)) return "pdf";
    if (DOCX_MIMES.has(mime)) return "docx";
    if (mime === "text/plain") return "txt";
    if (PLAIN_MIMES.has(mime)) return "md";
    if (IMAGE_RASTER_MIMES.has(mime)) return "image_raster";
    if (IMAGE_SVG_MIMES.has(mime)) return "image_svg";
    return "unknown";
}

export function isDocumentKind(kind: EnrichmentAssetKind): boolean {
    return kind === "pdf" || kind === "docx" || kind === "txt" || kind === "md";
}

export function isImageKind(kind: EnrichmentAssetKind): boolean {
    return kind === "image_raster" || kind === "image_svg";
}
