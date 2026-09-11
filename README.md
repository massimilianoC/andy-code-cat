# Andy Code Cat

![Andy Code Cat](docs/brand/andy.jpg)

> **Open-source AI website builder for teams, freelancers, founders, and agencies.**  
> Turn a plain-language idea into a production-ready website with chat refinement, visual editing, export, and publish flows built in.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org)
[![Docker](https://img.shields.io/badge/Docker-required-blue)](https://docs.docker.com)

---

> **Status: beta.** Used in production, still moving: APIs and the data model can change between
> releases. The current release is in [`RELEASE_VERSION`](RELEASE_VERSION).

## What Andy Code Cat Helps You Do

| Capability | Outcome |
| --- | --- |
| Three ways to start | **Vibe**: describe the site and attach documents. **Zero Effort**: answer a short guided form. **Project**: start from a template or a blank workspace |
| Live iteration | Refine copy, structure and layout in chat, with a live preview and version history |
| Visual editing | Pick an element in the preview and edit it, or ask the model to change only that part |
| Learn from the result | **Didactic Mode** explains the generated code in topics and quizzes, and answers questions about it |
| Portable delivery | Export static assets or publish under a managed slug |
| Open architecture | Self-hosted stack, multi-provider LLM support |

---

## Core Strengths

- **Multi-provider generation**: OpenRouter, SiliconFlow, or LM Studio for local inference
- **The model you pick is the model that runs**: a model the catalog cannot serve is refused
  with an error, never silently swapped for another
- **Full prompt transparency**: every model call is journalled. The **Prompt** tab shows, per work
  session, the system prompt split by layer, the prompt actually sent, the raw reply, duration and
  cost
- **Real cost accounting**: the cost the provider reports for each call where it exposes one, a
  price table or flat-rate estimate otherwise, in one ledger per project
- **Documents as context**: PDF, DOCX, XLSX, PPTX, CSV, TXT and Markdown attachments feed the brief
- **Working forms in generated sites**: a declarative form runtime, delivered by email (mailto)
- **Focused editing** for targeted HTML, CSS and JS changes, with recovery of interrupted runs
- **JWT auth and tenant isolation** with double-sandbox enforcement
- **Docker-first self-hosting** for local and domain deployments

---

## Architecture at a Glance

```text
apps/
  api/        Express API with Clean Architecture layers
  web/        Next.js App Router UI with Tailwind and shadcn/ui
packages/
  contracts/  Shared Zod schemas and API contracts
```

Supporting services: **MongoDB**, **MinIO** (object storage), **Redis**, and **nginx** as the
reverse proxy.

Start from [AGENTS.md](AGENTS.md) and [docs/INDEX.md](docs/INDEX.md) for the full repository contract and documentation map.

---

## Quick Start — Self-Hosted Deployment

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine + Compose v2
- `openssl` (pre-installed on Linux/macOS; available via Git Bash on Windows)
- At least one LLM API key — [OpenRouter](https://openrouter.ai/keys) or
  [SiliconFlow](https://cloud.siliconflow.com/account/ak). SiliconFlow keys are bound to their
  region: the platform calls `api.siliconflow.com`, so the key must come from the international
  console linked here, not from `siliconflow.cn`

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

> Do not run the dev `docker compose up` on a machine already running the deploy stack. Update
> deploy services with `docker compose -f docker-compose.deploy.yml up -d --no-deps api web`.

See [docs/guides/LOCAL_DOCKER_START.md](docs/guides/LOCAL_DOCKER_START.md) for the full dev workflow,
safe rebuild commands, and emergency mongosh promotion steps.

### Release gates

A change reaches `main` only through Gitflow, and only with all of these green:

| Command | Checks |
| --- | --- |
| `npx vitest run` in `apps/api` and `apps/web` | Unit suites |
| `npx tsc --noEmit -p .` in `apps/api`, `apps/web`, `packages/contracts` | Types |
| `npm run gitflow:guard` | Branch naming and merge direction |
| `npm run release:version:validate` | `RELEASE_VERSION` format (`YYYY.MM.DD.N`) |
| `npm run guard:public-repo` | No secrets, private keys, private infrastructure details or stray files in the public tree |

End-to-end specs in [`tests/e2e/`](tests/e2e/) run against a live stack and call real providers,
so they spend real money.

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
| [docs/handoff/SESSION_RESUME.md](docs/handoff/SESSION_RESUME.md) | Latest working state, measured findings, open issues |
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
