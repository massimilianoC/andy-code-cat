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

## Quick Start — Self-Hosted Deployment

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine + Compose v2
- `openssl` (pre-installed on Linux/macOS; available via Git Bash on Windows)
- At least one LLM API key — [SiliconFlow](https://siliconflow.cn/account/api-keys) (recommended, affordable) or [OpenRouter](https://openrouter.ai/keys)

### Step 1 — Clone and configure

```bash
git clone https://github.com/massimilianoC/andy-code-cat.git
cd andy-code-cat
```

Open `install.sh` and edit the **CONFIGURATION block at the top** (lines 29–43).
Nothing else needs to be changed.

**Local testing** — edit these two lines:

```bash
MODE="local"
SILICONFLOW_API_KEY="sk-..."      # or OPENROUTER_API_KEY
```

**Public domain with HTTPS** — edit all four lines:

```bash
MODE="domain"
DOMAIN="yourdomain.com"           # app.yourdomain.com  api.yourdomain.com
CERTBOT_EMAIL="admin@yourdomain.com"
SILICONFLOW_API_KEY="sk-..."
```

> **Domain mode prerequisite:** before running the script, create two DNS A records pointing to your server:
> `@` → `<server-IP>` and `*` → `<server-IP>`. Wait for propagation (~5 min).

### Step 2 — Run the installer

```bash
bash install.sh
```

The script generates secrets, builds Docker images, starts all containers, and (in domain mode)
obtains SSL certificates automatically via Let's Encrypt. It prints the URL at the end.

### Step 3 — Complete the setup wizard

Open the URL printed by the installer (e.g. `http://localhost/install`) and follow the
4-step wizard to:

1. Create the first superadmin account
2. Set the public domain and registration policy
3. (Optional) Configure custom MinIO storage
4. Review and confirm — the wizard locks permanently after this step

After the wizard completes, log in at `/login`.

---

## AI-Assisted Deployment

You can delegate the entire deployment to a coding agent (Claude, Cursor, Copilot, etc.).
Paste one of the prompts below into the agent chat.

### Prompt — local deployment

```
I want to deploy Andy Code Cat locally using Docker.

1. Open `install.sh` and set MODE="local" and SILICONFLOW_API_KEY="<my-key>".
2. Run `bash install.sh` and confirm it completes without errors.
3. Open http://localhost/install and tell me when the setup wizard is ready.

My SiliconFlow API key: <paste key here>
```

### Prompt — domain deployment (on a Linux VPS)

```
I want to deploy Andy Code Cat on this server with HTTPS.

1. Open `install.sh` and configure:
   - MODE="domain"
   - DOMAIN="<my-domain>"
   - CERTBOT_EMAIL="<my-email>"
   - SILICONFLOW_API_KEY="<my-key>"
2. Confirm that DNS A records for @ and * point to this server's public IP.
3. Run `bash install.sh` and confirm certificates are issued.
4. Open https://app.<my-domain>/install and tell me when the setup wizard is ready.

Domain: <my-domain>
Server IP: <IP>
SiliconFlow key: <paste key>
```

For more details see [docs/guides/LOCAL_DOCKER_START.md](docs/guides/LOCAL_DOCKER_START.md)
and [docs/specs/FIRST_INSTALL_SETUP_SPEC.md](docs/specs/FIRST_INSTALL_SETUP_SPEC.md).

---

## Development Commands

| Command | Purpose |
| --- | --- |
| `docker compose up -d` | Start the hot-reload dev stack (bind-mounted source) |
| `docker compose down` | Stop the dev stack |
| `npm run local:logs` | Tail all service logs |
| `npm run local:logs:api` | Tail API logs only |
| `npm run local:restart:api` | Restart the API without a full rebuild |

See [docs/guides/LOCAL_DOCKER_START.md](docs/guides/LOCAL_DOCKER_START.md) for the full dev workflow,
safe rebuild commands, and emergency mongosh promotion steps.

---

## Minimum Configuration Reference

`install.sh` generates `.env.docker` automatically. The minimum required settings are:

| Variable | Required | Description |
| --- | --- | --- |
| `SILICONFLOW_API_KEY` | One of the two | SiliconFlow LLM API key |
| `OPEN_ROUTER_API_KEY` | One of the two | OpenRouter LLM API key |
| `DOMAIN` | Domain mode only | Base domain (e.g. `example.com`) |
| `CERTBOT_EMAIL` | Domain mode only | Email for Let's Encrypt |

All other secrets (JWT, export token) are generated automatically by the installer.
Full variable reference: [`.env.deploy.example`](.env.deploy.example).

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
