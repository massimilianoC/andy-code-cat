/**
 * Pure display helpers of the project data panel, kept apart from the component so they can be
 * tested without a DOM.
 */

function previewValue(value: unknown): string {
    if (value === null || value === undefined) return "—";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value) ?? "";
}

/** One line, "key: value · key: value", whitespace collapsed, cut to `max` characters. */
export function previewOfData(data: Record<string, unknown>, max = 120): string {
    const text = Object.entries(data)
        .map(([key, value]) => `${key}: ${previewValue(value)}`)
        .join(" · ")
        .replace(/\s+/g, " ")
        .trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function pageCount(total: number, limit: number): number {
    return Math.max(1, Math.ceil(total / Math.max(1, limit)));
}

/** 1-based, inclusive range of the records shown on a page; {0, 0} when there are none. */
export function visibleRange(page: number, limit: number, total: number): { from: number; to: number } {
    if (total <= 0) return { from: 0, to: 0 };
    const from = (page - 1) * limit + 1;
    return { from: Math.min(from, total), to: Math.min(page * limit, total) };
}

export function prettyJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}
