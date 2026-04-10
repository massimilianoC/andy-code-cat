/**
 * Client-side thumbnail cache utilities.
 * Stores a full HTML document string (≤ 64 KB) and a prompt excerpt in
 * localStorage so ProjectCard can render a scaled mini-iframe preview without
 * an extra API call.
 *
 * Key schema (versioned with "v1" to allow future cache-busting):
 *   pf_th_v1_<projectId>  — full HTML document string
 *   pf_pe_v1_<projectId>  — first 250 chars of prePromptTemplate
 *   pf_nv_v1_<projectId>  — number of saved snapshot versions (decimal string)
 */

const THUMB_KEY = (id: string) => `pf_th_v1_${id}`;
const PROMPT_KEY = (id: string) => `pf_pe_v1_${id}`;
const COUNT_KEY = (id: string) => `pf_nv_v1_${id}`;

const MAX_DOC_SIZE = 64_000; // bytes — stay well inside 5 MB localStorage budget

/** Build a self-contained HTML document from snapshot artifacts. */
function buildDoc(artifacts: { html: string; css: string; js: string }): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${artifacts.css}</style></head><body>${artifacts.html}${artifacts.js ? `<script>${artifacts.js}</script>` : ""}</body></html>`;
}

/**
 * Save a thumbnail document to localStorage.
 * Silently skips if the document is too large or if storage is unavailable.
 */
export function saveThumbnail(
    projectId: string,
    artifacts: { html: string; css: string; js: string }
): void {
    if (typeof localStorage === "undefined") return;
    const doc = buildDoc(artifacts);
    if (doc.length > MAX_DOC_SIZE) return; // skip oversized documents
    try {
        localStorage.setItem(THUMB_KEY(projectId), doc);
    } catch {
        // quota exceeded — non-fatal
    }
}

/**
 * Save the first 250 characters of the pre-prompt template as a card excerpt.
 */
export function savePromptExcerpt(
    projectId: string,
    prePromptTemplate: string | null | undefined
): void {
    if (typeof localStorage === "undefined" || !prePromptTemplate) return;
    try {
        localStorage.setItem(PROMPT_KEY(projectId), prePromptTemplate.slice(0, 250));
    } catch {
        // quota exceeded — non-fatal
    }
}

/**
 * Increment the local snapshot version counter for the project.
 */
export function incrementSnapCount(projectId: string): void {
    if (typeof localStorage === "undefined") return;
    try {
        const current = parseInt(localStorage.getItem(COUNT_KEY(projectId)) ?? "0", 10);
        localStorage.setItem(COUNT_KEY(projectId), String(current + 1));
    } catch {
        // quota exceeded — non-fatal
    }
}

/** Read the cached thumbnail HTML document, or null if not present. */
export function getThumbnail(projectId: string): string | null {
    if (typeof localStorage === "undefined") return null;
    try {
        return localStorage.getItem(THUMB_KEY(projectId));
    } catch {
        return null;
    }
}

/** Read the cached prompt excerpt, or null if not present. */
export function getPromptExcerpt(projectId: string): string | null {
    if (typeof localStorage === "undefined") return null;
    try {
        return localStorage.getItem(PROMPT_KEY(projectId));
    } catch {
        return null;
    }
}

/** Read the local snapshot version count (0 if never saved). */
export function getSnapCount(projectId: string): number {
    if (typeof localStorage === "undefined") return 0;
    try {
        return parseInt(localStorage.getItem(COUNT_KEY(projectId)) ?? "0", 10);
    } catch {
        return 0;
    }
}
