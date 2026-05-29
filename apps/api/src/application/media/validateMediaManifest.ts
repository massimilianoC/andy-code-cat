import {
    artifactMediaManifestSchema,
    type ArtifactMediaManifest,
} from "@andy-code-cat/contracts";

export function validateMediaManifest(input: unknown): ArtifactMediaManifest | undefined {
    if (input === undefined || input === null) return undefined;

    const parsed = artifactMediaManifestSchema.safeParse(input);
    if (parsed.success) return parsed.data;

    // LLM output is unreliable: log the reason and return undefined so the caller
    // falls back gracefully (legacy URL resolution or placeholder strip) instead of
    // aborting the entire artifact generation.
    const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "mediaManifest"}: ${issue.message}`)
        .join("; ");
    console.warn(`[media] mediaManifest validation failed — dropping manifest, will process via legacy path. Reason: ${details}`);
    return undefined;
}
