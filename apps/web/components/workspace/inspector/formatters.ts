/** Presentation-only helpers shared by the Session Inspector blocks. No domain logic, no fetching. */

export function formatBytes(bytes: number | undefined): string {
    if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Renders an arbitrary field value (string/number/boolean/array/object/undefined) as short text. */
export function formatFieldValue(value: unknown): string {
    if (value === undefined || value === null || value === "") return "—";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.length > 0 ? value.map((v) => formatFieldValue(v)).join(", ") : "—";
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/** "businessName" -> "Business Name" — used only where the server doesn't supply a display label. */
export function humanizeFieldName(field: string): string {
    return field
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/^./, (c) => c.toUpperCase())
        .trim();
}
