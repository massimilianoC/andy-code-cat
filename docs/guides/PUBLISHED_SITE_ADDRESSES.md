# Published Site Addresses

How a published site is reached, how its address is shown, and what to do when the platform moves
to another server or domain.

## Two addresses, always served

Every live site answers at both, on the API origin and on the web origin:

| Address | Example | Notes |
|---|---|---|
| `/p/{publishId}/` | `/p/6d81b896/` | Permanent. Stored on the deployment (`url`), survives slug changes. |
| `/{slug}/` | `/my-site/` | When the site has a custom slug. Resolved to the live deployment's publishId. |

Both go through the same serving code (`publishRoutes.ts`: `sendSiteIndex` / `sendSiteFile`): same
suspension rules (admin-blocked site, blocked owner → 403), same CSP, same caching. A request without
the trailing slash is redirected to it, because published pages use relative `style.css` / `script.js`.

Routing:

- **API**: the slug router is mounted at the root, *last* (`app.ts`), so it can never shadow a route.
- **Web**: `apps/web/middleware.ts` forwards `/{slug}...` to the API (`API_INTERNAL_URL`, default
  `http://api:4000`, the compose service name). `next.config.mjs` sets `skipTrailingSlashRedirect`;
  the middleware restores the `/x/ → /x` redirect for app routes.
- **Reserved names**: a slug can never be a root segment the platform answers itself —
  `RESERVED_ROOT_SEGMENTS` in `packages/contracts/src/publish.ts` (app routes, `public/` entries,
  API root mounts). `apps/web/lib/__tests__/publishedSiteRouting.test.ts` fails if a new top-level
  web route or public entry is added without reserving it.

## Site code never runs on the app's origin

A published site runs code written by any user. On the app's origin that code would share the app's
storage — the session tokens live in `localStorage` (`apps/web/lib/token-store.ts`) — so a site opened
by a logged-in superadmin could act as them. Therefore:

- the **app hosts** are the hostnames in `CORS_ORIGIN`;
- a request for site content (`/p/{id}/…`, `/{slug}/…`) that arrives on an app host is **redirected
  (301)** to the same file on the site's own address — so links handed out on the app host keep
  working — or **refused (404, logged)** when the installation has no separate address to send it to
  (`decideSiteRequest` in `publicSiteAddress.ts`);
- the web middleware forwards the browser's host to the API (`x-forwarded-host`) so the API can tell.

A single-host installation (app and API on one origin) therefore needs a **sites
origin**: a second hostname for the same stack, e.g. `https://sites.example.com`. On a split
deployment (`app.` and `api.` hosts) the API host already is a separate origin.

### Rules added by the 2026-11-23 security review (release 2026.11.23.4)

- **Sites origin is an allow-list.** With a sites origin configured, site content is served on that
  host only; every other host is redirected there. A sites origin equal to an app host is refused.
- **Only live deployments are served.** `/p/{x}/` answers only when `x` is the publishId of a live
  deployment — never a slug copy or an orphan directory — so suspension (admin block, blocked owner)
  applies on every address. The owner check fails closed (503) if the user cannot be read.
- **Slug lock.** A unique MongoDB index (`customSlug_unique_active`, partial on `deploying`/`live`)
  is the semaphore: a concurrent second claim gets 409. The database claim happens before any slug
  directory is written, copied or deleted.
- **Separate namespaces.** Slugs shaped like a publishId (8 lowercase hex chars,
  `PUBLISH_ID_SHAPE_RE`) are reserved: slug copies and publishIds share `data/www/`.
- **User files never execute.** `/p/media/:assetId` ignores the declared MIME type for execution:
  passive types (jpeg/png/gif/webp/avif/bmp/ico, mp4/webm, mp3/ogg/wav, pdf) are inline; everything
  else is `attachment`, script-capable types become `application/octet-stream`, SVG keeps its type for
  `<img>`; all with `nosniff` and a `sandbox` CSP (`apps/api/src/presentation/http/security/userFileHeaders.ts`).
  External references redirect to `http(s)` only.
- **Preview and workspace.** Asset ids read from generated HTML must be plain ids of the current
  project before an authenticated fetch; the workspace accepts `postMessage` only from its own preview
  iframe, and EDIT saves only in EDIT mode.

## Which address is shown: the publish URL mode

Set by the superadmin in **/admin/config → Published sites** (`PlatformConfig.publicSites`), one value
for the whole installation:

| Mode | Shown address | Needs |
|---|---|---|
| `path` (default) | `{sitesOrigin}/{slug}/`, or `{sitesOrigin}/p/{publishId}/` without a slug; without a sites origin, relative to the API origin | One hostname and certificate for all sites, distinct from the app's |
| `subdomain` | `https://{slug or publishId}.{publicDomain}` | Wildcard DNS and a wildcard certificate for `*.{publicDomain}` routed to the published-site server; the wildcard vhost must proxy `/p/` to the API for capture forms ([Forms Capture](../specs/FORMS_CAPTURE.md)) |

The address is computed at read time by one function, `resolvePublicSiteUrl`
(`apps/api/src/application/publish/publicSiteAddress.ts`), and returned as `publicUrl` by the publish
endpoints, the project list (`publishedUrl`) and the superadmin project registry. In path mode it is
origin-relative; the web app resolves it against its API origin (`resolvePublicSiteAddress`).

Subdomain mode cannot be saved without a bare public domain (no scheme, port or path):
`publicSitesConfigSchema` in `packages/contracts/src/admin.ts`.

## Moving to another server or domain

Nothing is stored per site except `/p/{publishId}` and the slug, so:

- **path mode**: set the new sites origin (none needed if the new API origin is its own host).
- **subdomain mode**: set the new domain (or switch to path) in /admin/config, or from a shell:

```bash
docker exec andy-code-cat-api node apps/api/dist/scripts/set-public-sites.js path https://sites.example.com
docker exec andy-code-cat-api node apps/api/dist/scripts/set-public-sites.js subdomain example.com
```

Every existing site takes the new address at once. Old `/p/{publishId}/` links keep working.

## History

Until 2026-11, the subdomain address came from the `PUBLIC_DOMAIN` environment variable, while a
`governanceByProduct.*.nginx.publicDomain` field in the database was saved but never read. Both are
gone; `PlatformConfig.publicSites` is the only source. A deployment that relied on `PUBLIC_DOMAIN`
must set `publicSites` once when it takes this release (see AGENT_RELEASE_CHECKLIST §10).
