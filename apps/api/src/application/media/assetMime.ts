import path from "path";

const MIME_EXTENSION_MAP: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "image/svg+xml": ".svg",
};

export function preferredExtensionForMimeType(mimeType?: string): string | null {
    const normalized = mimeType?.split(";")[0]?.trim().toLowerCase();
    if (!normalized) return null;

    if (MIME_EXTENSION_MAP[normalized]) {
        return MIME_EXTENSION_MAP[normalized];
    }

    if (!normalized.startsWith("image/")) {
        return null;
    }

    const subtype = normalized.slice("image/".length).replace(/[^a-z0-9+.-]/g, "");
    if (!subtype) return null;
    if (subtype === "svg+xml") return ".svg";
    return `.${subtype}`;
}

export function replaceFileExtension(filename: string, nextExtension: string): string {
    const parsed = path.parse(filename);
    const normalizedExtension = nextExtension.startsWith(".") ? nextExtension.toLowerCase() : `.${nextExtension.toLowerCase()}`;
    return `${parsed.name}${normalizedExtension}`;
}

export function resolveStoredAssetNames(input: {
    originalName: string;
    storedFilename: string;
    mimeType?: string;
}): { originalName: string; storedFilename: string } {
    const preferredExtension = preferredExtensionForMimeType(input.mimeType);
    if (!preferredExtension) {
        return {
            originalName: input.originalName,
            storedFilename: input.storedFilename,
        };
    }

    return {
        originalName: replaceFileExtension(input.originalName, preferredExtension),
        storedFilename: replaceFileExtension(input.storedFilename, preferredExtension),
    };
}
