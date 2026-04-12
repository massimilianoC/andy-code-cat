<p align="center">
  <img src="docs/brand/andy.jpg" alt="Andy Code Cat" width="120" />
</p>

# Andy Code Cat

**AI-powered website builder platform.** An open-source, self-hostable platform that lets users create, edit, and publish websites using natural language and a visual editor, with a multi-provider LLM backend, cost tracking, and a full export/publish pipeline.

[![License: Limited Use](https://img.shields.io/badge/License-Limited%20Use-orange.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![Docker](https://img.shields.io/badge/Docker-required-blue)](https://docs.docker.com)

---

## Features

- **AI page generation** - Generate full HTML pages from a prompt using OpenRouter, SiliconFlow, or LM Studio (local).
- **Visual editor** - GrapesJS-based WYSIWYG editor with focused-edit AI assistance.
- **Multi-provider LLM** - Swap between providers and models at runtime via environment variables.
- **Cost tracking** - Per-session token cost metering with configurable cost policies.
- **Export and publish** - Export to static HTML and publish under a custom domain.
- **Onboarding and style profiling** - Guided onboarding extracts user style preferences to prime the AI.
- **Authentication** - JWT access + refresh tokens, with user sandbox isolation per project.
- **Monorepo** - Express API + Next.js 14 web app + shared contracts package.

---

## Architecture

```text
apps/
  api/        Express API - Clean Architecture (domain / application / infra / presentation)
  web/        Next.js 14 - App Router, Tailwind CSS, shadcn/ui
packages/
  contracts/  Shared types and Zod validation schemas (single source of truth)
```

Services: **MongoDB**, **Redis**, **nginx** (reverse proxy). All wired via Docker Compose.

See [AGENTS.md](AGENTS.md) for the full architecture contract and layer rules.

---

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose v2)
- Node.js 20+ (only needed to run npm scripts locally)

### 1. Clone

```bash
git clone https://github.com/massimilianoC/andy-code-cat.git
cd andy-code-cat
```

### 2. Configure environment

```bash
cp .env.example .env.docker

# Edit .env.docker - at minimum set one LLM API key:
# SILICONFLOW_API_KEY=...
# OPEN_ROUTER_API_KEY=...
```

Get a free API key at [openrouter.ai/keys](https://openrouter.ai/keys). Free models work without credits.

### 3. Start the stack

First run (or after code changes):

```bash
npm run local:build:nocache
npm run local:up
```

Subsequent runs (cached):

```bash
npm run local:up
```

### 4. Open the app

| Service | URL |
|---|---|
| Web UI | <http://localhost> |
| API health | <http://localhost:4000/health> |

### 5. Seed initial data

```bash
npm run seed
```

---

## Development

### Hot-reload mode

```bash
npm run local:dev:up    # start with hot-reload (bind-mount sources)
npm run local:dev:down  # stop
```

### Useful commands

```bash
npm run local:logs          # tail all service logs
npm run local:logs:api      # tail API logs only
npm run local:restart:api   # restart API only (after env change, no rebuild)
```

### Stop

```bash
npm run local:down
```

---

## Environment Variables

Copy `.env.example` to `.env.docker` for local development.
Copy `.env.deploy.example` to `.env.deploy` for production-like environments.

| Variable | Description |
|---|---|
| SILICONFLOW_API_KEY | SiliconFlow API key |
| OPEN_ROUTER_API_KEY | OpenRouter API key |
| JWT_ACCESS_SECRET | JWT signing secret (min 32 chars) |
| MONGODB_URI | MongoDB connection string |
| LLM_DEFAULT_PROVIDER | Active LLM provider (`siliconflow`, `openrouter`, `lmstudio`) |
| PUBLIC_DOMAIN | Publish subdomain base (production only) |

See `.env.example` for the full reference.

---

## Docker Compose Stacks

| File | Purpose |
|---|---|
| docker-compose.yml | Local development (bind mounts + hot-reload) |
| docker-compose.deploy.yml | Production-style local testing (named volumes) |

**Important:** In deploy-mode, MongoDB data is stored in the named Docker volume `andy-code-cat_mongodb_data`. Do not mix stack commands across compose files unless you explicitly intend to work with different data stores.

---

## Public/Private Boundaries

This is a public repository. Keep production-only material local and private.

- Keep live secrets and deploy-only files local (`.env.docker`, `.env.droplet`, `.deploy/`, `docker-compose.droplet.yml`).
- Do not commit production infrastructure details (live IPs, DNS tokens, private runbooks).
- Commit sanitized templates only (`.env.example`, `.env.deploy.example`).

See [docs/PRIVATE_CONFIG_GUIDE.md](docs/PRIVATE_CONFIG_GUIDE.md) and [docs/guides/PUBLIC_REPO_CHECKLIST.md](docs/guides/PUBLIC_REPO_CHECKLIST.md).

---

## Documentation

| Doc | Description |
|---|---|
| [AGENTS.md](AGENTS.md) | Architecture contract, layer rules, agent guidelines |
| [docs/INDEX.md](docs/INDEX.md) | Documentation entry point |
| [docs/agents/CODE_AGENT_INDEX.md](docs/agents/CODE_AGENT_INDEX.md) | Navigation guide for AI coding agents |
| [docs/architecture/](docs/architecture/) | Service topology, pipeline layers |
| [docs/specs/](docs/specs/) | Feature specifications |
| [docs/guides/](docs/guides/) | Guides and runbooks |
| [docs/security/SECURITY_BASELINE.md](docs/security/SECURITY_BASELINE.md) | Security baseline |

---

## Contributing

Contributions are welcome.

- Fork the repository, then create your branch from `develop` (not `main`).
- This project follows full Gitflow: feature branches target `develop`, release branches are `release/YYYY.MM.DD.N`, and hotfix branches start from `main`.
- The canonical repository release version lives in `RELEASE_VERSION` using `YYYY.MM.DD.N`, for example `2026.04.12.6`.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(scope): description`, `fix(scope): description`, etc.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.
- Read [AGENTS.md](AGENTS.md) for architecture and branching contracts used by both humans and coding agents.
- Read [docs/guides/GITFLOW_RELEASE_POLICY.md](docs/guides/GITFLOW_RELEASE_POLICY.md) for release flow, tags, and branch semantics.

---

## License

Copyright (c) 2026 Massimiliano Camillucci

This project is released under a **Limited Use License - Non-Commercial and Non-Profit Use Only**.
Free for personal, educational, and non-profit use. Commercial use requires a separate written agreement.

See [LICENSE](LICENSE) for full terms (Italian/English).
