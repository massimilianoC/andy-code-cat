# Published Site Addresses

How a published site is reached, how its address is shown, and what to do when the platform moves
to another server or domain.

## Two addresses, always served

Every live site answers at both, on the API origin and on the web origin:

| Address | Example | Notes |
|---|---|---|
| `/p/{publishId}/` | `/p/6d81b896/` | Permanent. Stored on the deployment (`url`), survives slug changes. |
| `/{slug}/` | `/antares/` | When the site has a custom slug. Resolved to the live deployment's publishId. |

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

## Which address is shown: the publish URL mode

Set by the superadmin in **/admin/config → Published sites** (`PlatformConfig.publicSites`), one value
for the whole installation:

| Mode | Shown address | Needs |
|---|---|---|
| `path` (default) | `{origin}/{slug}/`, or `{origin}/p/{publishId}/` without a slug | Nothing beyond the app's own origin and certificate |
| `subdomain` | `https://{slug or publishId}.{publicDomain}` | Wildcard DNS and a wildcard certificate for `*.{publicDomain}` routed to the published-site server |

The address is computed at read time by one function, `resolvePublicSiteUrl`
(`apps/api/src/application/publish/publicSiteAddress.ts`), and returned as `publicUrl` by the publish
endpoints, the project list (`publishedUrl`) and the superadmin project registry. In path mode it is
origin-relative; the web app resolves it against its API origin (`resolvePublicSiteAddress`).

Subdomain mode cannot be saved without a bare public domain (no scheme, port or path):
`publicSitesConfigSchema` in `packages/contracts/src/admin.ts`.

## Moving to another server or domain

Nothing is stored per site except `/p/{publishId}` and the slug, so:

- **path mode**: nothing to do — addresses follow the new origin.
- **subdomain mode**: set the new domain (or switch to path) in /admin/config, or from a shell:

```bash
docker exec andy-code-cat-api node apps/api/dist/scripts/set-public-sites.js path
docker exec andy-code-cat-api node apps/api/dist/scripts/set-public-sites.js subdomain example.com
```

Every existing site takes the new address at once. Old `/p/{publishId}/` links keep working.

## History

Until 2026-11, the subdomain address came from the `PUBLIC_DOMAIN` environment variable, while a
`governanceByProduct.*.nginx.publicDomain` field in the database was saved but never read. Both are
gone; `PlatformConfig.publicSites` is the only source. A deployment that relied on `PUBLIC_DOMAIN`
must set `publicSites` once when it takes this release (see AGENT_RELEASE_CHECKLIST §10).
