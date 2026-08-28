/**
 * Pure segmentation logic behind PromptTranscriptView — kept out of the .tsx so it can be
 * unit-tested without a JSX transform.
 */

export type Segment =
    | { kind: "prose"; text: string }
    | { kind: "code"; text: string; lang?: string };

function looksLikeCodeLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return (
        /^<\/?[a-zA-Z!][^>]*>/.test(trimmed) ||
        /^[.#@][\w-]+\s*\{/.test(trimmed) ||
        /^[\w-]+\s*:\s*[^;]+;$/.test(trimmed) ||
        /^\}$/.test(trimmed) ||
        /^(const|let|var|function|import|export|return|if|for|while)\b/.test(trimmed)
    );
}

/** Groups runs of 4+ consecutive code-looking lines into code segments. */
function splitBareCode(text: string): Segment[] {
    const lines = text.split("\n");
    const segments: Segment[] = [];
    let buffer: string[] = [];
    let bufferIsCode = false;

    const flush = () => {
        if (buffer.length === 0) return;
        const joined = buffer.join("\n");
        // A short run of code-ish lines is usually prose that happens to contain a tag —
        // folding it would hide more than it helps.
        segments.push(
            bufferIsCode && buffer.length >= 4
                ? { kind: "code", text: joined }
                : { kind: "prose", text: joined },
        );
        buffer = [];
    };

    for (const line of lines) {
        const isCode = looksLikeCodeLine(line);
        if (buffer.length > 0 && isCode !== bufferIsCode) flush();
        bufferIsCode = isCode;
        buffer.push(line);
    }
    flush();

    return segments;
}

/**
 * Splits a message into prose and code segments.
 *
 * Fenced blocks are the reliable signal. Beyond those, a run of consecutive lines that reads as
 * markup or a stylesheet is treated as code too: generated artifacts routinely arrive as bare
 * HTML with no fence, and those are precisely the blocks that bury the conversation.
 */
export function splitIntoSegments(content: string): Segment[] {
    const segments: Segment[] = [];
    const fencePattern = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
    let cursor = 0;

    for (let match = fencePattern.exec(content); match; match = fencePattern.exec(content)) {
        if (match.index > cursor) {
            segments.push(...splitBareCode(content.slice(cursor, match.index)));
        }
        segments.push({ kind: "code", text: match[2] ?? "", lang: match[1] || undefined });
        cursor = match.index + match[0].length;
    }

    if (cursor < content.length) {
        segments.push(...splitBareCode(content.slice(cursor)));
    }

    return segments.filter((segment) => segment.text.trim().length > 0);
}
