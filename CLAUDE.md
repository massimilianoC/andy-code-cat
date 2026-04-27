# CLAUDE.md

This file defines repository-specific operating rules for Claude-based coding agents working in this project.

## Read First

Before making changes, read in this order:

1. `AGENTS.md`
2. `docs/INDEX.md`
3. `docs/agents/CODE_AGENT_INDEX.md`
4. `docs/guides/GITFLOW_RELEASE_POLICY.md`
5. `docs/guides/AGENT_RELEASE_CHECKLIST.md`

## Documentation Placement

Keep the repository root limited to entry-point files.
Detailed architecture notes, specs, roadmaps, and operational guides belong under `docs/` and must remain linked from `docs/INDEX.md`.

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

## Deployment and First-Install

### New deployments — always use `install.sh`

`install.sh` at the repo root is the single entry point for all new deployments.

1. Open `install.sh` and edit the `CONFIGURATION` block at the top:
   - Set `MODE="local"` or `MODE="domain"`
   - Set `DOMAIN` and `CERTBOT_EMAIL` (domain mode only)
   - Set at least one LLM API key (`SILICONFLOW_API_KEY` or `OPENROUTER_API_KEY`)
2. Run: `bash install.sh`

The script generates `.env.docker`, builds Docker images, starts all containers, and (in domain
mode) obtains SSL certificates via certbot. It prints the URL at the end.

Do NOT run `install.sh` on an existing deployment — it skips `.env.docker` regeneration if the
file already exists, but will still rebuild and restart containers.

Full guide: `docs/guides/LOCAL_DOCKER_START.md`

### After install — complete the setup wizard

After `install.sh` completes, the platform is uninitialized (no superadmin account exists).

- **Local:** navigate to `http://localhost/install`
- **Domain:** navigate to `https://app.DOMAIN/install`

The wizard creates the first superadmin, seeds `PlatformConfig`, and locks permanently.
The system is considered installed when `existsWithRole("superadmin")` returns true.

Full spec: `docs/specs/FIRST_INSTALL_SETUP_SPEC.md`

### What Claude agents must NOT do

- Do not create superadmin accounts via seed scripts on a production or deploy stack.
  The `/install` wizard is the only supported path.
- Do not call `npm run seed` on a deploy stack without explicit operator instruction.
  `seed.ts` is for dev stacks only (creates a test user + project).
- Do not modify `.env.docker` after generation by `install.sh` without operator confirmation.
- Do not run `docker compose up` (dev file) when the running stack is the deploy stack.
  Use `--no-deps` with the correct compose file to update individual services.
