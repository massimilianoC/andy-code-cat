<p align="center">
  <img src="docs/brand/andy.jpg" alt="Andy Code Cat" width="120" />
</p>

# Andy Code Cat

**AI-powered website builder platform.** An open-source, self-hostable platform that lets users create, edit, and publish websites using natural language and a visual editor — with a multi-provider LLM backend, cost tracking, and a full export/publish pipeline.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![Docker](https://img.shields.io/badge/Docker-required-blue)](https://docs.docker.com)

---

## Features

- **AI page generation** — generate full HTML pages from a prompt using OpenRouter, SiliconFlow, or LM Studio (local)
- **Visual editor** — GrapesJS-based WYSIWYG editor with focused-edit AI assistance
- **Multi-provider LLM** — swap between providers and models at runtime via environment variables
- **Cost tracking** — per-session token cost metering with configurable cost policies
- **Export & publish** — export to static HTML, publish under a custom domain
- **Onboarding & style profiling** — guided onboarding extracts user style preferences to prime the AI
- **Authentication** — JWT access + refresh tokens, user sandbox isolation per project
- **Monorepo** — Express API + Next.js 14 web app + shared contracts package

---

## Architecture

`
apps/
  api/        Express API — Clean Architecture (domain / application / infra / presentation)
  web/        Next.js 14 — App Router, Tailwind CSS, shadcn/ui
packages/
  contracts/  Shared types and Zod validation schemas (single source of truth)
`

Services: **MongoDB**, **Redis**, **nginx** (reverse proxy). All wired via Docker Compose.

See [AGENTS.md](AGENTS.md) for the full architecture contract and layer rules.

---

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose v2)
- Node.js 20+ (only needed to run npm scripts locally)

### 1. Clone

`bash
git clone https://github.com/massimilianoC/andy-code-cat.git
cd andy-code-cat
`

### 2. Configure environment

`bash
cp .env.example .env.docker
# Edit .env.docker — at minimum set the LLM API keys:
#   SILICONFLOW_API_KEY=  or  OPEN_ROUTER_API_KEY=
`

Get a free API key at [openrouter.ai/keys](https://openrouter.ai/keys) — free models work without credits.

### 3. Start the stack

First run (or after code changes):

`bash
npm run local:build:nocache
npm run local:up
`

Subsequent runs (cached):

`bash
npm run local:up
`

### 4. Open the app

| Service | URL |
|---|---|
| Web UI | <http://localhost> |
| API health | <http://localhost:4000/health> |

### 5. Seed initial data

`bash
npm run seed
`

---

## Development

### Hot-reload mode

`bash
npm run local:dev:up    # start with hot-reload (bind-mount sources)
npm run local:dev:down  # stop
`

### Useful commands

`bash
npm run local:logs          # tail all service logs
npm run local:logs:api      # tail API logs only
npm run local:restart:api   # restart API only (after env change, no rebuild)
`

### Stop

`bash
npm run local:down
`

---

## Environment Variables

Copy .env.example → .env.docker for local dev.
Copy .env.deploy.example → .env.deploy for production.

Key variables:

| Variable | Description |
|---|---|
| SILICONFLOW_API_KEY | SiliconFlow API key |
| OPEN_ROUTER_API_KEY | OpenRouter API key |
| JWT_ACCESS_SECRET | JWT signing secret (min 32 chars) |
| MONGODB_URI | MongoDB connection string |
| LLM_DEFAULT_PROVIDER | Active LLM provider (siliconflow \| openrouter \| lmstudio) |
| PUBLIC_DOMAIN | Publish subdomain base (production only) |

See .env.example for the full reference.

---

## Docker Compose Stacks

| File | Purpose |
|---|---|
| docker-compose.yml | Local dev — bind-mount sources, hot-reload |
| docker-compose.deploy.yml | Production-style — pre-built images, named volumes |

**Important:** MongoDB data is stored in a **named Docker volume** (ndy-code-cat_mongodb_data) in the deploy stack. Never mix the two stacks on the same machine without understanding this.

---

## Documentation

| Doc | Description |
|---|---|
| [AGENTS.md](AGENTS.md) | Architecture contract, layer rules, agent guidelines |
| [docs/agents/CODE_AGENT_INDEX.md](docs/agents/CODE_AGENT_INDEX.md) | Navigation guide for AI coding agents |
| [docs/architecture/](docs/architecture/) | Service topology, pipeline layers |
| [docs/specs/](docs/specs/) | Feature specs (export, publish, RAG, optimizer...) |
| [docs/guides/](docs/guides/) | Runbooks (i18n, local Docker setup, OpenRouter) |
| [docs/security/SECURITY_BASELINE.md](docs/security/SECURITY_BASELINE.md) | Security baseline |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE) © 2026 Massimiliano Camillucci
