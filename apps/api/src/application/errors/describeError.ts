/**
 * An error, with the reason underneath it.
 *
 * `fetch` is the case that forced this. When a request cannot be made at all, undici throws
 * `TypeError: fetch failed` and puts the actual reason — DNS failure, refused connection, an
 * expired TLS certificate — in `cause`. Logging `error.message` alone therefore records the one
 * phrase that is true of every network failure and none of the words that identify this one.
 *
 * On 2026-09-07 a provider let its certificate lapse mid-morning; every didactic generation
 * started returning 500 `fetch failed`, and finding out why meant opening a shell in the running
 * container and repeating the request by hand. `CERT_HAS_EXPIRED` was in the thrown object the
 * whole time — one dereference away, discarded at every logging site.
 *
 * Same principle as `describeGeneratedJavaScriptSyntaxError`: when something says no, it should
 * say what it saw.
 */

/** One link of the chain: the code when the error carries one, since that is the identifying part. */
function describeOne(value: unknown): string {
    if (!(value instanceof Error)) return String(value);
    const code = (value as Error & { code?: unknown }).code;
    return typeof code === "string" && code ? `${code}: ${value.message}` : value.message;
}

/**
 * Renders an error and its `cause` chain as one line, outermost first:
 *
 *     fetch failed <- CERT_HAS_EXPIRED: certificate has expired
 *
 * `maxDepth` is a guard, not a policy — a cause chain can be circular, and a log line is not the
 * place to find that out.
 */
export function describeError(error: unknown, maxDepth = 4): string {
    const parts: string[] = [];
    let current: unknown = error;

    for (let depth = 0; depth < maxDepth && current !== undefined && current !== null; depth++) {
        const part = describeOne(current);
        // A cause that only repeats its parent adds a separator and no information.
        if (part && part !== parts[parts.length - 1]) parts.push(part);
        current = current instanceof Error ? current.cause : undefined;
    }

    return parts.join(" <- ") || "Unknown error";
}
