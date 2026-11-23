# Agent Release Checklist

Use this checklist when an agent prepares a feature branch, release branch, hotfix, PR, merge, or tag in this repository.

## 0. Fetch First

Run `git fetch origin --prune` before making or reporting any claim about what is merged,
released, or deployed. A stale local `main`/`develop` ref produces confidently wrong conclusions
(see `docs/guides/GITFLOW_RELEASE_POLICY.md` §"Preventing Commit Regressions"). If a file under
`nginx/sites-enabled/`, `docker-compose.droplet.yml`, `.env.droplet`, or `scripts/*-droplet.sh`
is being touched, read that same section before editing it — those files are intentionally
gitignored from `origin` and need the private remote, not a normal PR.

## 1. Confirm Scope

- Confirm whether the work is a feature, fix, docs-only change, chore, refactor, release stabilization, or hotfix.
- Confirm whether the branch must start from `develop` or `main`.
- Confirm whether the change affects release policy, docs, contracts, or runtime behavior.

## 2. Choose The Correct Branch Type

- Use `feat/<name>` for new functionality.
- Use `fix/<name>` for bug fixes.
- Use `docs/<name>` for documentation-only changes.
- Use `chore/<name>` for tooling, repository policy, dependency, or configuration work.
- Use `refactor/<name>` for internal restructuring without behavior changes.
- Use `release/<RELEASE_VERSION>` only for release stabilization.
- Use `hotfix/<name>` only for urgent production fixes based on `main`.

## 3. Validate Release Identity

- Read `RELEASE_VERSION` before any release operation.
- Ensure the value follows `YYYY.MM.DD.N`.
- Never treat `package.json` version as the canonical repository release number.
- If the release identifier changes, update all docs and guidance that reference it.

## 4. Check Branch Governance

- Never commit directly to `main`.
- Never commit directly to `develop`.
- Never create feature work from `main`.
- Never put new feature scope on `release/*`.
- Never leave a hotfix only on `main`; it must come back to `develop`.

## 5. Keep Commits Coherent

- Group only logically related files in the same commit.
- Keep infrastructure, docs, and code changes separate when they represent different concerns.
- Use Conventional Commits: `type(scope): description`.
- Do not create WIP commits.
- Do not rewrite shared branch history.

## 6. Run Local Guards

Run:

```bash
npm run release:version
npm run release:version:validate
npm run gitflow:guard
```

If the change touches code paths, also run the relevant build, lint, and test commands before proposing a merge.

## 7. Prepare The Pull Request

- Target `develop` for `feat/*`, `fix/*`, `docs/*`, `chore/*`, and `refactor/*` branches.
- Target `main` first for `release/*` and `hotfix/*` branches.
- Include a concise change summary.
- Name the owning spec/rules and state observable acceptance for non-trivial behaviour changes.
- Classify risk as `routine`, `material`, or `critical` using `AGENTS.md`, and state any recovery or
  rollback concern.
- List the proportionate validation commands or manual evidence; use `N/A` with a reason instead of
  running an irrelevant check.

## 8. Release Branch Rules

On `release/*`, allow only:

- `fix(...)`
- `docs(...)`
- `chore(...)`

Do not add:

- new features
- broad refactors
- opportunistic cleanup unrelated to release readiness

## 9. Merge And Tag Sequence

For a standard release:

1. Branch from `develop` as `release/<RELEASE_VERSION>`.
2. Stabilize and review.
3. Merge into `main`.
4. Tag `main` with `RELEASE_VERSION`.
5. Back-merge the release branch into `develop`.

For a hotfix:

1. Branch from `main` as `hotfix/<name>`.
2. Apply the minimal fix.
3. Merge into `main`.
4. Tag a new release if published.
5. Back-merge into `develop`.

> **Operational note**: if the repository has GitHub's "Automatically delete head branches"
> setting enabled, the `release/<RELEASE_VERSION>` (or `hotfix/<name>`) branch is deleted from
> the remote as soon as its PR into `main` merges — even if the merge was done with
> `gh pr merge --delete-branch=false` (that flag only controls whether the CLI *also* deletes it;
> it does not override the repo-level auto-delete setting). This breaks step 5: opening a PR from
> that branch into `develop` fails with a "head ref invalid" / "no commits between" error because
> the remote branch no longer exists. Before opening the back-merge PR, check with
> `git ls-remote --heads origin release/<RELEASE_VERSION>`; if it's gone, the local branch still
> has the commits — just re-push it with `git push -u origin release/<RELEASE_VERSION>` and then
> open the PR.

## 10. Post-Deploy Data Steps (MANDATORY when applicable)

### Preset catalog reseed — binding when `ProjectPreset.ts` changed

If the release touches `apps/api/src/domain/entities/ProjectPreset.ts` (preset modules,
`outputSpec`, **`viewportModel`**), the Mongo preset registry MUST be reseeded **in the same
deploy operation** — it is not optional and must not be deferred:

- The live catalog is Mongo-backed and wins over the static catalog.
- Until reseed, stored presets lack the new fields; a code-level fallback
  (`withStaticViewportFallback`, PP-018) keeps the window safe for `viewportModel`, but any
  other preset content change (prompt modules, templates) is NOT covered and will keep serving
  stale prompts until reseed.

Production (droplet):

```bash
npm run droplet:deploy
npm run droplet:seed -- --only-presets
```

Local deploy stack: see `docs/runbooks/PRESET_RESEED.md` for the per-stack commands and
verification steps (including the `viewportModel` check).

### Published-site address setting — binding once, for deployments that used `PUBLIC_DOMAIN`

The release that introduced `PlatformConfig.publicSites` removed the `PUBLIC_DOMAIN` environment
variable. A deployment that had it set (subdomain links, e.g. the droplet) shows path addresses
until the setting is saved — sites keep being served either way. In the same deploy operation:

```bash
docker exec andy-code-cat-api node apps/api/dist/scripts/set-public-sites.js subdomain <the old PUBLIC_DOMAIN>
```

or set it in /admin/config → Published sites. See `docs/guides/PUBLISHED_SITE_ADDRESSES.md`.

From 2026.11.23.3 site content is never served on an app host (`CORS_ORIGIN`): it is redirected to the
site's own address, or refused when there is none. A **single-host** installation (app and API on one
origin) must have a sites origin set *before* it takes that release, or its site links stop working:
`set-public-sites.js path https://<sites host>` (and the sites host routed to the stack).

## 11. Final Agent Sanity Check

- The branch name matches the Gitflow policy.
- The release identifier is consistent everywhere.
- The PR target is correct.
- No unrelated local changes were included.
- The merge path preserves Gitflow semantics.
