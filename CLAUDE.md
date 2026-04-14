# CLAUDE.md

This file defines repository-specific operating rules for Claude-based coding agents working in this project.

## Read First

Before making changes, read in this order:

1. `AGENTS.md`
2. `docs/agents/CODE_AGENT_INDEX.md`
3. `docs/guides/GITFLOW_RELEASE_POLICY.md`
4. `docs/guides/AGENT_RELEASE_CHECKLIST.md`
5. `docs/INDEX.md`

## Repository Governance

This repository uses full Gitflow.

- `main` = stable released code
- `develop` = integration branch
- feature work branches from `develop`
- release branches are named `release/YYYY.MM.DD.N`
- hotfix branches are named `hotfix/<name>` and branch from `main`

Never propose or perform direct pushes to `main` or `develop`.

## Release Versioning

The repository publication version is stored in `RELEASE_VERSION`.

- Format: `YYYY.MM.DD.N`
- Example: `2026.04.12.6`
- Release branch example: `release/2026.04.12.6`
- Release tag example: `2026.04.12.6`

Do not treat the release version as the npm package version. `package.json` remains SemVer-compatible for tooling stability.

## Gitflow Rules For Claude Agents

1. New work starts from `develop` unless it is a hotfix.
2. `feat/*`, `fix/*`, `docs/*`, `chore/*`, and `refactor/*` target `develop`.
3. `release/*` branches are for stabilization only.
4. `hotfix/*` branches start from `main` and must be merged back into both `main` and `develop`.
5. Use Conventional Commits: `type(scope): description`.

## What Claude Must Avoid

- Do not invent alternative branch names outside the approved prefixes.
- Do not suggest publishing from `develop`.
- Do not place feature work on `release/*` or `hotfix/*`.
- Do not rewrite history on shared branches.

## Validation Commands

Use:

```bash
npm run release:version
npm run release:version:validate
npm run gitflow:guard
```

Before branch, commit, merge, or release operations, also follow `docs/guides/AGENT_RELEASE_CHECKLIST.md`.

## Architecture Guardrails

Claude agents must also respect all architectural constraints already defined in `AGENTS.md`, especially:

- clean architecture boundaries
- double sandbox enforcement
- no hardcoded secrets
- documentation updates when repository structure changes
