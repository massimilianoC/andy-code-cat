# Andy Code Cat

![Andy Code Cat](docs/brand/andy.jpg)

> **Open-source AI website builder for teams, freelancers, founders, and agencies.**  
> Turn a plain-language idea into a production-ready website with chat refinement, visual editing, export, and publish flows built in.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![Docker](https://img.shields.io/badge/Docker-required-blue)](https://docs.docker.com)

---

## What Andy Code Cat Helps You Do

| Capability | Outcome |
| --- | --- |
| Prompt-to-site generation | Build landing pages and mini-sites from a natural-language brief |
| Live iteration | Refine copy, structure, and layout through chat with preview feedback |
| Visual editing | Combine AI generation with a WYSIWYG editing workflow |
| Portable delivery | Export static assets or publish directly under managed infrastructure |
| Open architecture | Run on a self-hosted stack with multi-provider LLM support |

---

## Core Strengths

- **AI-powered generation** using OpenRouter, SiliconFlow, or LM Studio
- **Focused editing** for targeted HTML, CSS, and JS updates
- **Runtime model routing** configurable through environment settings
- **Export and publish flows** for ZIP delivery and hosted output
- **JWT auth and tenant isolation** with double-sandbox enforcement
- **Docker-first self-hosting** for both local and deploy-like stacks

---

## Architecture at a Glance

```text
apps/
  api/        Express API with Clean Architecture layers
  web/        Next.js App Router UI with Tailwind and shadcn/ui
packages/
  contracts/  Shared Zod schemas and API contracts
```

Supporting services: **MongoDB**, **Redis**, **nginx**, and a dedicated workspace container for generation workflows.

Start from [AGENTS.md](AGENTS.md) and [docs/INDEX.md](docs/INDEX.md) for the full repository contract and documentation map.

---

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine with Compose v2
- Node.js 20+ for local package scripts

### 1. Clone the repository

```bash
git clone https://github.com/massimilianoC/andy-code-cat.git
cd andy-code-cat
```

### 2. Configure the environment

```bash
cp .env.example .env.docker

# Then set at least one provider key, for example:
# SILICONFLOW_API_KEY=...
# OPEN_ROUTER_API_KEY=...
```

### 3. Build and start the stack

```bash
npm run local:build:nocache
npm run local:up
```

### 4. Open the application

| Service | URL |
| --- | --- |
| Web UI | [http://localhost](http://localhost) |
| API health | [http://localhost:4000/health](http://localhost:4000/health) |

### 5. Seed initial data

```bash
npm run seed
```

---

## Common Development Commands

| Command | Purpose |
| --- | --- |
| `npm run local:dev:up` | Start the hot-reload development stack |
| `npm run local:dev:down` | Stop the hot-reload stack |
| `npm run local:logs` | Tail all service logs |
| `npm run local:logs:api` | Tail API logs only |
| `npm run local:restart:api` | Restart the API without a full rebuild |
| `npm run local:down` | Stop the stack |

---

## Environment Reference

Copy `.env.example` to `.env.docker` for local development.
Use `.env.deploy.example` as the sanitized reference for deploy-like environments.

| Variable | Description |
| --- | --- |
| SILICONFLOW_API_KEY | SiliconFlow API key |
| OPEN_ROUTER_API_KEY | OpenRouter API key |
| JWT_ACCESS_SECRET | JWT signing secret |
| MONGODB_URI | MongoDB connection string |
| LLM_DEFAULT_PROVIDER | Default LLM provider |
| PUBLIC_DOMAIN | Base domain for publication |

---

## Documentation Map

| Entry point | Purpose |
| --- | --- |
| [docs/INDEX.md](docs/INDEX.md) | Full documentation index |
| [docs/agents/CODE_AGENT_INDEX.md](docs/agents/CODE_AGENT_INDEX.md) | Agent-oriented codebase map |
| [docs/architecture/BOOTSTRAP_ARCHITECTURE.md](docs/architecture/BOOTSTRAP_ARCHITECTURE.md) | Platform structure and runtime overview |
| [docs/specs/](docs/specs/) | Technical and feature specifications |
| [docs/guides/](docs/guides/) | Operational guides and policies |
| [docs/runbooks/](docs/runbooks/) | Validation and hardening runbooks |

---

## Contributing

Contributions are welcome.

- Branch from `develop`, not `main`
- Follow Gitflow and Conventional Commits
- Update [docs/INDEX.md](docs/INDEX.md) whenever documentation moves or new docs are added
- Read [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), and [docs/guides/GITFLOW_RELEASE_POLICY.md](docs/guides/GITFLOW_RELEASE_POLICY.md) before opening a PR

---

## License

Copyright (c) 2026 Massimiliano Camillucci

This project is licensed under the **GNU Affero General Public License v3.0**.
See [LICENSE](LICENSE) for the full text.
