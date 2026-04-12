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

## 10. Final Agent Sanity Check

- The branch name matches the Gitflow policy.
- The release identifier is consistent everywhere.
- The PR target is correct.
- No unrelated local changes were included.
- The merge path preserves Gitflow semantics.