const MAX_BYTES = 4 * 1024 * 1024;
const MAX_DIMENSION = 2048;

export interface ResizeResult {
    buffer: Buffer;
    resized: boolean;
}

export async function prepareImageBuffer(buffer: Buffer): Promise<ResizeResult> {
    if (buffer.length <= MAX_BYTES) {
        return { buffer, resized: false };
    }

    try {
        // sharp is an optional dependency — import dynamically so the rest of
        // the system works even when sharp is not installed.
        const sharp = (await import("sharp")).default;
        const resized = await sharp(buffer)
            .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
            .toBuffer();
        return { buffer: resized, resized: true };
    } catch {
        // sharp not installed or resize failed — proceed with original buffer
        console.warn("[ImageResizeGuard] sharp unavailable or failed; using original buffer");
        return { buffer, resized: false };
    }
}
