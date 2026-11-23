import { isPublicSiteSlug } from "@andy-code-cat/contracts";

/**
 * Where a request on the web origin goes. Published sites live at `/{slug}/` on the same origin
 * as the app (publish URL mode "path"), so the web server forwards those paths to the API, which
 * serves them exactly as it serves `/p/{publishId}/`.
 *
 * Kept separate from middleware.ts so it can be unit-tested without the Next runtime.
 */
export type WebRouteDecision =
    | { kind: "published-site"; apiPath: string }
    | { kind: "strip-trailing-slash"; pathname: string }
    | { kind: "app" };

export function decideWebRoute(pathname: string): WebRouteDecision {
    const firstSegment = pathname.split("/")[1] ?? "";
    if (isPublicSiteSlug(firstSegment)) {
        // Path forwarded verbatim, trailing slash included: the API redirects /slug to /slug/.
        return { kind: "published-site", apiPath: pathname };
    }
    // next.config sets skipTrailingSlashRedirect so published sites keep their trailing slash;
    // app routes get Next's default behaviour back here (/login/ -> /login).
    if (pathname.length > 1 && pathname.endsWith("/")) {
        return { kind: "strip-trailing-slash", pathname: pathname.replace(/\/+$/, "") || "/" };
    }
    return { kind: "app" };
}
