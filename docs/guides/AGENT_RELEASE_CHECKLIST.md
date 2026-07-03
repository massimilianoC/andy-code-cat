# Agent Release Checklist

Use this checklist when an agent prepares a feature branch, release branch, hotfix, PR, merge, or tag in this repository.

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
- State the risk level and any rollback concern.
- List the validation commands that were run.

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

## 11. Final Agent Sanity Check

- The branch name matches the Gitflow policy.
- The release identifier is consistent everywhere.
- The PR target is correct.
- No unrelated local changes were included.
- The merge path preserves Gitflow semantics.