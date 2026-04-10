# Documentation Index

## Agent-first Reading Order

Coding agents should read in this order before making changes:

1. [AGENTS.md](../AGENTS.md) — architecture contract, layer rules, sandbox model
2. [docs/agents/CODE_AGENT_INDEX.md](agents/CODE_AGENT_INDEX.md) — codebase navigation
3. [docs/architecture/BOOTSTRAP_ARCHITECTURE.md](architecture/BOOTSTRAP_ARCHITECTURE.md) — current build state
4. [docs/architecture/PIPELINE_LAYERS.md](architecture/PIPELINE_LAYERS.md) — 2-layer pipeline architecture
5. [docs/security/SECURITY_BASELINE.md](security/SECURITY_BASELINE.md) — auth and isolation baseline
6. [docs/runbooks/TESTABLE_STEPS.md](runbooks/TESTABLE_STEPS.md) — testable milestones

---

## Architecture

| Document | Description |
|---|---|
| [docs/architecture/BOOTSTRAP_ARCHITECTURE.md](architecture/BOOTSTRAP_ARCHITECTURE.md) | Current codebase structure, clean architecture map |
| [docs/architecture/PIPELINE_LAYERS.md](architecture/PIPELINE_LAYERS.md) | 2-layer pipeline (Chat Preview + focused edit), SSE events, double sandboxing |

---

## Agent Navigation

| Document | Description |
|---|---|
| [docs/agents/CODE_AGENT_INDEX.md](agents/CODE_AGENT_INDEX.md) | Entry point for coding agents — current state, what to build, patterns to follow |
| [docs/agents/LLM_PROVIDER_HANDOFF_RECAP.md](agents/LLM_PROVIDER_HANDOFF_RECAP.md) | LLM catalog and chat-preview implementation recap |

---

## Guides & Runbooks

| Document | Description |
|---|---|
| [docs/runbooks/TESTABLE_STEPS.md](runbooks/TESTABLE_STEPS.md) | Testable steps per milestone (M0 baseline → M5) |
| [docs/guides/LOCAL_DOCKER_START.md](guides/LOCAL_DOCKER_START.md) | Local Docker setup (dev and deploy mode) |
| [docs/guides/OPENROUTER_INTEGRATION_GUIDE.md](guides/OPENROUTER_INTEGRATION_GUIDE.md) | OpenRouter integration guide (multi-provider, cost policy, model selector) |
| [docs/guides/I18N.md](guides/I18N.md) | i18n system — architecture, translation keys, adding new strings |
| [docs/security/SECURITY_BASELINE.md](security/SECURITY_BASELINE.md) | Auth baseline, tenant isolation, data safety |

---

## Technical Specifications

| Document | Description |
|---|---|
| [SPEC.md](../SPEC.md) | Backend API platform — REST endpoints, data model, base workflow |
| [DB_PLATFORM_SPEC.md](../DB_PLATFORM_SPEC.md) | MongoDB schemas, nginx config, credit system |
| [PROVIDER_SPEC.md](../PROVIDER_SPEC.md) | Multi-provider LLM, SiliconFlow adapter, TypeScript interface |
| [PREPROMPT_ENGINE_SPEC.md](../PREPROMPT_ENGINE_SPEC.md) | PrepromptEngine spec (Layer 2, Stage A) |
| [WORKFLOWS.md](../WORKFLOWS.md) | Automated workflows WF-01 to WF-10 |
| [UX_SPEC.md](../UX_SPEC.md) | Full UX flow, 6-step wizard, screens |
| [EXECUTION_LOG_SPEC.md](../EXECUTION_LOG_SPEC.md) | execution_logs collection schema (MongoDB TTL 90d) |
| [FOCUSED_EDIT_SPEC.md](../FOCUSED_EDIT_SPEC.md) | Focused edit feature spec |

---

## Feature Specs (docs/specs/)

| Document | Description |
|---|---|
| [EXPORT_AND_PUBLISH_SPEC.md](specs/EXPORT_AND_PUBLISH_SPEC.md) | ZIP export + web publishing (subdomain model) |
| [UX_REVIEW_AND_PUBLISH_SPEC.md](specs/UX_REVIEW_AND_PUBLISH_SPEC.md) | UX review workspace + path-based publish |
| [WYSIWYG_EDIT_MODE_SPEC.md](specs/WYSIWYG_EDIT_MODE_SPEC.md) | WYSIWYG editor (GrapesJS), architecture, milestones |
| [ONBOARDING_AND_STYLE_PROFILING_SPEC.md](specs/ONBOARDING_AND_STYLE_PROFILING_SPEC.md) | Onboarding wizard, style profiling, Layer 0 preprompting |
| [PRESET_TYPED_SPECS.md](specs/PRESET_TYPED_SPECS.md) | Typed preset catalog, output spec, modular prompt architecture |
| [SECTION_CONTEXT_OPT_SPEC.md](specs/SECTION_CONTEXT_OPT_SPEC.md) | Section-aware context optimization (40-60% token reduction) |
| [PROMPT_OPTIMIZER_SPEC.md](specs/PROMPT_OPTIMIZER_SPEC.md) | Prompt optimizer UX — inline enrichment, undo buffer, rate limiting |
| [BAAS_SERVICES_SPEC.md](specs/BAAS_SERVICES_SPEC.md) | BaaS layer — forms, payments, webhooks, SDK |
| [RAG_CHATBOT_SPEC.md](specs/RAG_CHATBOT_SPEC.md) | RAG chatbot for landing pages — BYOK, document ingestion, vanilla JS widget |
| [MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md](specs/MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md) | Multi-provider, multi-model platform playbook |
