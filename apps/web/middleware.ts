import { NextResponse, type NextRequest } from "next/server";
import { decideWebRoute } from "./lib/publishedSiteRouting";

/**
 * Internal address of the API as seen from the web server. "api" is the service name in every
 * compose stack (dev, deploy, office, droplet); override it only for a non-compose dev setup.
 */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://api:4000";

export function middleware(request: NextRequest) {
    const { pathname, search } = request.nextUrl;
    const decision = decideWebRoute(pathname);

    if (decision.kind === "published-site") {
        // The API decides whether a site may run on this host (never on the app's own origin), so
        // it must see the host the browser asked for, not api:4000.
        const headers = new Headers(request.headers);
        headers.set("x-forwarded-host", request.headers.get("host") ?? request.nextUrl.host);
        return NextResponse.rewrite(new URL(`${decision.apiPath}${search}`, API_INTERNAL_URL), { request: { headers } });
    }
    if (decision.kind === "strip-trailing-slash") {
        // A plain URL, not nextUrl.clone(): NextURL re-applies the incoming trailing slash when it
        // is serialised, which turned this redirect into a /login/ -> /login/ loop.
        return NextResponse.redirect(new URL(`${decision.pathname}${search}`, request.url), 308);
    }
    return NextResponse.next();
}

export const config = {
    // Everything except Next's own assets; app routes return NextResponse.next() at once.
    matcher: ["/((?!_next/).*)"],
};
