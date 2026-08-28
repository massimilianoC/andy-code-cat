import { Router } from "express";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * The release version this build was cut from, resolved once at module load.
 *
 * `RELEASE_VERSION` at the repository root is the SSOT for the publication version (see
 * CLAUDE.md, "Release Versioning"): calendar notation YYYY.MM.DD.N, distinct from the SemVer
 * in package.json which exists only to keep npm tooling happy. The value is baked into the
 * image at build time via the RELEASE_VERSION build arg, so a running container reports the
 * version of the code inside it and cannot drift from it.
 *
 * The fallback is deliberately "unknown" rather than a hardcoded number: a wrong version is
 * worse than an absent one when the whole point is knowing what is deployed.
 */
function resolveReleaseVersion(): string {
    const fromEnv = process.env.RELEASE_VERSION?.trim();
    if (fromEnv) return fromEnv;
    // Dev convenience: outside Docker the file sits at the repo root.
    for (const candidate of ["RELEASE_VERSION", "../RELEASE_VERSION", "../../RELEASE_VERSION"]) {
        try {
            const value = readFileSync(join(process.cwd(), candidate), "utf-8").trim();
            if (value) return value;
        } catch { /* try the next candidate */ }
    }
    return "unknown";
}

const releaseVersion = resolveReleaseVersion();

export function createHealthRoutes(): Router {
    const router = Router();

    router.get("/health", (_req, res) => {
        res.json({ status: "ok", service: "api", version: releaseVersion });
    });

    /**
     * Unauthenticated on purpose: the web header calls this on every page load to show what is
     * deployed and to flag a web/API version mismatch. It exposes nothing an anonymous visitor
     * could not infer from the served bundle.
     */
    router.get("/version", (_req, res) => {
        res.json({ service: "api", version: releaseVersion });
    });

    return router;
}
