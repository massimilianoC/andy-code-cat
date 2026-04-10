# AGENTS.md - Project Operating Contract

This file defines mandatory implementation rules for all coding agents working in this repository.

## Mission

Build and evolve a dockerized multi-service platform based on:

- Node.js
- Express API
- Next.js web app
- MongoDB and Redis services

Architecture goals:

- Clean Architecture
- single responsibility
- clean code
- modern and proven design patterns
- single source of truth for contracts and docs

## Non-Negotiable Rules

1. Never bypass security middleware in protected routes.
2. Never access MongoDB directly from presentation routes.
3. Never mix domain logic inside infrastructure adapters.
4. Never introduce project logic without user + project sandbox checks.
5. Never hardcode secrets in code.
6. Never break workspace contract paths without updating docs index.

## Source Of Truth

- API validation contracts: packages/contracts
- Runtime topology: docker-compose.yml
- Environment contract: .env.example and apps/api/src/config.ts
- Agent navigation docs: docs/INDEX.md

When conflicts exist, apply this priority:

1. AGENTS.md
2. docs/INDEX.md and docs/agents/CODE_AGENT_INDEX.md
3. technical specs (SPEC.md, DB_PLATFORM_SPEC.md, WORKFLOWS.md)

## Required Architecture

### API Layering

apps/api/src is organized as:

- domain
  - entities
  - repositories (interfaces)
- application
  - use-cases
- infra
  - db adapters
  - repository implementations
  - security adapters
- presentation
  - http routes
  - middlewares

### Dependency Direction

Allowed direction only:

- presentation -> application -> domain
- infra -> domain

Forbidden:

- domain -> infra
- domain -> presentation
- application -> presentation

## Tenant Isolation Model (Double Sandbox)

Every user-facing mutable operation must enforce:

1. User sandbox:
   - resolve user identity from JWT subject.
2. Project sandbox:
   - resolve project from x-project-id.
   - verify ownership binding project.ownerUserId == jwt.sub.

If either check fails, deny access.

## Authentication Baseline

- JWT access token for API calls.
- JWT refresh token for session continuity.
- refresh token stored as hash only.
- registration + login routes are mandatory.
- email verification architecture is mandatory; bootstrap may bypass via env flag.

## Docker Baseline

The project must run from one docker-compose.yml with:

- web
- api
- mongodb
- redis
- workspace

Mandatory networking rules:

- internal service communication on compose network.
- host mongo port mapped to non-default 27018 to avoid conflicts.
- host redis port mapped to non-default 6380.

## CRITICAL: Two Docker Compose Stacks — Never Mix

This project has TWO compose files with DIFFERENT MongoDB storage strategies:

| File | MongoDB volume | Usage |
|---|---|---|
| `docker-compose.yml` | bind mount `./data/mongodb` | dev stack |
| `docker-compose.deploy.yml` | named volume `andy-code-cat_mongodb_data` | production/test stack |

**Data in the named Docker volume `andy-code-cat_mongodb_data` is separate from the dev bind mount.**
**The dev bind mount `./data/mongodb` is a DIFFERENT database — do not mix them.**

Non-negotiable rules for agents:

1. NEVER run `docker compose up` (dev file) to apply env changes when the running stack is deploy.
2. To update env vars on the DEPLOY stack without touching MongoDB or Redis:

   ```
   docker compose -f docker-compose.deploy.yml up -d --no-deps api
   ```

3. To update env vars on the DEV stack without touching MongoDB or Redis:

   ```
   docker compose up -d --no-deps api
   ```

4. ALWAYS use `--no-deps` when targeting a single service. Without it, Docker recreates all dependency containers.
5. Before running ANY `docker compose` command, verify which stack is currently running:

   ```
   docker ps --format '{{.Names}}'
   ```

6. NEVER run `docker compose down` during a live session without explicit user confirmation.

## Frontend UI Framework (apps/web)

### Stack

- **Next.js 14** — App Router, all pages `"use client"` (no SSR)
- **Tailwind CSS 3** — `@tailwind base/components/utilities` at top of `globals.css`; `preflight: false` to preserve existing workspace CSS vars
- **shadcn/ui** — primitive components pre-installed under `apps/web/components/ui/`
- **Radix UI** — underlying headless primitives (dialog, dropdown-menu, label, scroll-area, separator, slot)
- **lucide-react** — icon set
- **Path alias** — `@/*` maps to `apps/web/` in tsconfig

### Non-Negotiable Rules

1. **Never use raw `<input>`, `<button>`, `<label>` elements** in page or component files — always use `Input`, `Button`, `Label` from `@/components/ui/`.
2. **Never use inline styles** (`style={{...}}`) in new UI code — use Tailwind utility classes only.
3. **Never use old CSS class names** (`.card`, `.form-group`, `.status`, `.link`, `.subtitle`) in new components — these are legacy public-layout globals; use shadcn Card, Badge, and Tailwind text utilities instead.
4. **Never add new light-theme color classes** (`bg-white`, `text-gray-*`, `border-gray-*`, `bg-indigo-*`) — use semantic tokens: `bg-card`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `border-border`.
5. **Dark theme palette** is defined in `tailwind.config.ts` under `theme.extend.colors` — never hardcode hex values.
6. **Do NOT touch** `components/GrapesJsEditorPanel.tsx` or any workspace/Monaco editor component.

### Available UI Primitives (`apps/web/components/ui/`)

| File | Component(s) | Use for |
|---|---|---|
| `button.tsx` | `Button` | All clickable actions; variants: default, outline, ghost, secondary, destructive, link |
| `input.tsx` | `Input` | All text/email/password inputs |
| `label.tsx` | `Label` | Form field labels |
| `card.tsx` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | Content containers, auth forms |
| `dialog.tsx` | `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` | Modals, confirmations |
| `dropdown-menu.tsx` | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator` | Context menus |
| `badge.tsx` | `Badge` | Status tags; variants: default, secondary, destructive, outline, success, accent |
| `separator.tsx` | `Separator` | Dividers |
| `scroll-area.tsx` | `ScrollArea` | Overflow containers |

### Shared Utilities

- `cn(...classes)` from `@/lib/utils` — always use for conditional class merging (replaces `clsx` / manual joins)

### Route Structure

| Route group | Layout | Purpose |
|---|---|---|
| `app/(public)/` | nav bar + 640px main | Landing, login, register |
| `app/dashboard/` | none (full-width) | Dashboard shell |
| `app/onboarding/` | none (full-width) | Onboarding wizard |
| `app/workspace/` | none (full-width) | GrapesJS + AI editor |

### Adding New Packages

Any new Radix/shadcn package requires:

1. `npm install <pkg> -w apps/web` on the host
2. Create the primitive in `apps/web/components/ui/`
3. Rebuild the deploy stack: `npm run docker:test:nocache` (or `docker:test` for cached)

## Repository Hygiene — Keep the Root Clean for Contributors

This project is open-source and regularly visited by external contributors ("ospiti") who clone, run, and explore the codebase. A clean root is a non-negotiable courtesy.

### Rules

1. **Never place temporary scripts, debug files, or one-off test files at the repository root.** Root-level files must be permanent fixtures: Docker configs, package manifests, documented specs, README, AGENTS.md.
2. **All test code belongs under `tests/`.** This includes manual debug scripts, Playwright feature tests, and integration helpers.
3. **All generated test artifacts are gitignored.** Playwright outputs go to `tests/test-results/` and `tests/e2e/report/` — both are in `.gitignore` and must never be committed.
4. **Scratch files and debug samples belong under `debug/`.** That folder is gitignored; use it for exploratory work that should not reach the repo.
5. **`health_test.json` and similarly named probe files are gitignored.** Do not let throwaway validation files accumulate at the root.
6. **When you finish a task, delete any temporary helper files you created.** Leave the tree in the same (or better) shape you found it.

> A contributor who clones this repo should see a self-explanatory, navigable structure — not a graveyard of experiments.

## Coding Rules

- Keep functions small and focused.
- Validate all external input with shared contracts.
- Prefer explicit typing in API and use-cases.
- Use meaningful names; avoid abbreviations that hide intent.
- Add concise comments only where intent is non-obvious.

## Documentation Rules

Any structural change must be reflected in:

- docs/INDEX.md
- docs/architecture/BOOTSTRAP_ARCHITECTURE.md
- docs/runbooks/TESTABLE_STEPS.md

## Stepwise Delivery Protocol

Always implement in testable increments:

1. Start service health.
2. auth register/login.
3. project CRUD minimal path.
4. session creation with double sandbox.
5. seed scripts for bootstrap users/projects.

## Seed Requirements

Provide and maintain a seed script that:

- creates a default owner user if missing.
- creates at least one project for that user.
- is idempotent.

## LLM Provider Configuration — Runtime Only, No Seed Required

LLM providers, models, API keys, and token limits are fully resolved at runtime from environment variables.

- `LLM_CATALOG_SOURCE=env` (default and active in .env.docker) — the catalog is built from env, NOT from MongoDB.
- `LLM_CATALOG_SOURCE=mongo` — only in this mode does `seed-llm.ts` need to run to populate MongoDB.
- **Provider API keys** (`SILICONFLOW_API_KEY`, `OPEN_ROUTER_API_KEY`) are in `.env.docker` — never in code.
- **Token limits** (`LLM_DEFAULT_MAX_COMPLETION_TOKENS`, `LLM_MAX_COMPLETION_TOKENS`) are in `.env.docker`.
- To change any LLM setting: edit `.env.docker`, then run `docker compose -f docker-compose.deploy.yml up -d --no-deps api`.
- `seed.ts` seeds user + project only. `seed-llm.ts` seeds the catalog only when `LLM_CATALOG_SOURCE=mongo`.

## Git & Branch Contract

This project follows **Gitflow**. Agents must respect the following rules when proposing or executing any git-related operation.

### Branch model

| Branch | Purpose | Push allowed |
|---|---|---|
| `main` | Stable, released code — never commit directly | No — PRs only |
| `develop` | Integration target — all features merge here | No — PRs only |
| `feat/<name>` | New feature, branched off `develop` | Yes (via PR only) |
| `fix/<name>` | Bug fix, branched off `develop` | Yes (via PR only) |
| `hotfix/<name>` | Critical production fix, branched off `main`; merged into both `main` and `develop` | Yes (via PR only) |
| `docs/<name>` | Documentation changes only | Yes (via PR only) |
| `chore/<name>` | Tooling, config, dependency bumps | Yes (via PR only) |
| `refactor/<name>` | Code restructuring, no behaviour change | Yes (via PR only) |

### Non-Negotiable Rules

1. **Never propose a direct push to `main` or `develop`** — all changes go through PRs.
2. **All feature and fix branches must be created off `develop`**, not `main`.
3. **Hotfix branches only**: base off `main`, merge back into both `main` and `develop`.
4. **One logical change per commit** — no "WIP" or stacked unrelated changes in a single commit.
5. **Commit messages must follow Conventional Commits**: `type(scope): description`.
6. **Never rewrite published history** — no `git push --force` or `--force-with-lease` on `main` or `develop`.
7. **PRs target `develop`** unless it is a hotfix (which targets `main`).

### Commit message format

```
<type>(<scope>): <short imperative description>

[optional body — explain why, not what]

[optional footer — Closes #42 | Refs #17]
```

Valid types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`.

## Guardrails For Agents

Before coding:

1. Read docs/agents/CODE_AGENT_INDEX.md.
2. Validate impact on layer boundaries.
3. Validate impact on sandbox and auth.
4. Check which Docker compose stack is running before any `docker compose` command.

After coding:

1. Run available checks and smoke tests.
2. Update documentation index and runbooks when needed.
3. Report residual risks explicitly.
4. Never restart MongoDB or Redis to propagate env changes — use `--no-deps` on the correct compose file.
