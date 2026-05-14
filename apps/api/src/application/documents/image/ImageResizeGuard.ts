const MAX_BYTES = 4 * 1024 * 1024;
const MAX_DIMENSION = 2048;

// Formats that vision LLMs cannot ingest reliably as data URLs — must be
// transcoded to JPEG before being sent to the model.
const TRANSCODE_MIMES = new Set([
    "image/heic",
    "image/heif",
    "image/avif",
    "image/tiff",
    "image/bmp",
]);

export interface ResizeResult {
    /** Possibly transcoded + resized image buffer. */
    buffer: Buffer;
    /** Whether the source bytes were resized. */
    resized: boolean;
    /** MIME type matching the returned buffer (may differ from input when transcoded). */
    mimeType: string;
}

/**
 * Prepare an image buffer for the vision LLM.
 *
 * - Transcodes HEIC/HEIF/AVIF/TIFF/BMP to JPEG via sharp (vision providers
 *   reject or mis-decode these formats as data URLs).
 * - Resizes anything over MAX_BYTES down to MAX_DIMENSION on the longest side.
 * - Falls back to the original buffer when sharp is not installed or fails.
 */
export async function prepareImageBuffer(buffer: Buffer, mimeType: string): Promise<ResizeResult> {
    const lower = mimeType.toLowerCase().split(";")[0]!.trim();
    const needsTranscode = TRANSCODE_MIMES.has(lower);
    const needsResize = buffer.length > MAX_BYTES;

    if (!needsTranscode && !needsResize) {
        return { buffer, resized: false, mimeType: lower };
    }

    try {
        const sharp = (await import("sharp")).default;
        let pipeline = sharp(buffer, { failOn: "none" });

        if (needsResize) {
            pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
                fit: "inside",
                withoutEnlargement: true,
            });
        }

        const targetMime = needsTranscode ? "image/jpeg" : lower;
        const output = needsTranscode
            ? await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer()
            : await pipeline.toBuffer();

        return { buffer: output, resized: needsResize, mimeType: targetMime };
    } catch (err) {
        console.warn(
            `[ImageResizeGuard] sharp pipeline failed for ${lower} (needsTranscode=${needsTranscode}, needsResize=${needsResize}); using original buffer`,
            err instanceof Error ? err.message : err,
        );
        return { buffer, resized: false, mimeType: lower };
    }
}
