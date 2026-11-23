import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { RESERVED_ROOT_SEGMENTS, SLUG_BLACKLIST } from "@andy-code-cat/contracts";
import { decideWebRoute } from "../publishedSiteRouting";

const WEB_ROOT = path.resolve(__dirname, "../..");

/** Top-level URL segments the web app answers: app/ routes (route groups are transparent) + public/. */
function webRootSegments(): string[] {
    const segments = new Set<string>();
    const collect = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            if (/^\(.*\)$/.test(entry.name)) collect(path.join(dir, entry.name)); // (group)
            else if (!entry.name.startsWith("_") && !entry.name.startsWith("[")) segments.add(entry.name);
        }
    };
    collect(path.join(WEB_ROOT, "app"));
    for (const entry of fs.readdirSync(path.join(WEB_ROOT, "public"))) segments.add(entry);
    return [...segments].sort();
}

describe("reserved root segments", () => {
    it("cover every top-level web route and public entry, so no slug can hide a page", () => {
        const missing = webRootSegments().filter((segment) => !SLUG_BLACKLIST.includes(segment.toLowerCase()));
        // If this fails, add the segment to RESERVED_ROOT_SEGMENTS in packages/contracts/src/publish.ts.
        expect(missing).toEqual([]);
    });

    it("are routed to the app, never to the API as a site", () => {
        for (const segment of RESERVED_ROOT_SEGMENTS) {
            expect(decideWebRoute(`/${segment}`).kind, segment).not.toBe("published-site");
            expect(decideWebRoute(`/${segment}/x`).kind, segment).not.toBe("published-site");
        }
    });
});

describe("decideWebRoute", () => {
    it("forwards /{slug}, /{slug}/ and /{slug}/file to the API verbatim", () => {
        expect(decideWebRoute("/antares")).toEqual({ kind: "published-site", apiPath: "/antares" });
        expect(decideWebRoute("/antares/")).toEqual({ kind: "published-site", apiPath: "/antares/" });
        expect(decideWebRoute("/antares/style.css")).toEqual({ kind: "published-site", apiPath: "/antares/style.css" });
        expect(decideWebRoute("/bar-sport-runner/data/rows.json")).toEqual({ kind: "published-site", apiPath: "/bar-sport-runner/data/rows.json" });
    });

    it("keeps the home page and app routes in the app", () => {
        expect(decideWebRoute("/")).toEqual({ kind: "app" });
        expect(decideWebRoute("/dashboard")).toEqual({ kind: "app" });
        expect(decideWebRoute("/workspace/abc123")).toEqual({ kind: "app" });
        expect(decideWebRoute("/favicon.ico")).toEqual({ kind: "app" });
    });

    it("restores the trailing-slash redirect for app routes only", () => {
        expect(decideWebRoute("/login/")).toEqual({ kind: "strip-trailing-slash", pathname: "/login" });
        expect(decideWebRoute("/workspace/abc/")).toEqual({ kind: "strip-trailing-slash", pathname: "/workspace/abc" });
    });

    it("does not treat non-slug shapes as sites", () => {
        expect(decideWebRoute("/Antares").kind).toBe("app");      // uppercase
        expect(decideWebRoute("/-bad").kind).toBe("app");         // leading hyphen
        expect(decideWebRoute("/a").kind).toBe("app");            // too short
    });
});
