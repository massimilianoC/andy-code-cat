# Documentation Index

This repository keeps the root intentionally small. Long-form documentation, specifications, and runbooks live under `docs/` and are linked here for both humans and coding agents.

## Agent-First Reading Order

Read in this order before making changes:

1. [AGENTS.md](../AGENTS.md) — repository contract, architecture rules, sandbox requirements
2. [docs/agents/CODE_AGENT_INDEX.md](agents/CODE_AGENT_INDEX.md) — codebase map and implementation boundaries
3. [docs/architecture/BOOTSTRAP_ARCHITECTURE.md](architecture/BOOTSTRAP_ARCHITECTURE.md) — current platform shape
4. [docs/architecture/PIPELINE_LAYERS.md](architecture/PIPELINE_LAYERS.md) — generation pipeline and layer model
5. [docs/security/SECURITY_BASELINE.md](security/SECURITY_BASELINE.md) — security, auth, and isolation baseline
6. [docs/guides/GITFLOW_RELEASE_POLICY.md](guides/GITFLOW_RELEASE_POLICY.md) — branch and release governance
7. [docs/runbooks/TESTABLE_STEPS.md](runbooks/TESTABLE_STEPS.md) — verification path for current milestones

---

## Product & Project

| Document | Description |
|---|---|
| [README.md](../README.md) | Public project overview, quick start, and positioning |
| [docs/DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) | Stable planning entry point for agents and contributors |
| [docs/project/ROADMAP.md](project/ROADMAP.md) | Project roadmap and release direction |
| [docs/project/WORKFLOW_PIPELINE_MODULARIZATION_PLAN.md](project/WORKFLOW_PIPELINE_MODULARIZATION_PLAN.md) | Reuse-first implementation plan for zero-effort flows, backend orchestration, and future node-based pipelines |
| [docs/PRIVATE_CONFIG_GUIDE.md](PRIVATE_CONFIG_GUIDE.md) | Owner-only guidance for public/private repo hygiene |

---

## Architecture

| Document | Description |
|---|---|
| [docs/architecture/BOOTSTRAP_ARCHITECTURE.md](architecture/BOOTSTRAP_ARCHITECTURE.md) | Current services, route map, storage adapters, and governance status |
| [docs/architecture/PIPELINE_LAYERS.md](architecture/PIPELINE_LAYERS.md) | Layer 1 preview flow, Layer 2 generation pipeline, and transition mechanics |
| [docs/security/SECURITY_BASELINE.md](security/SECURITY_BASELINE.md) | Auth baseline, tenant isolation, and operational security rules |

---

## Agent Navigation

| Document | Description |
|---|---|
| [docs/agents/CODE_AGENT_INDEX.md](agents/CODE_AGENT_INDEX.md) | Primary entry point for coding agents |
| [docs/agents/LLM_PROVIDER_HANDOFF_RECAP.md](agents/LLM_PROVIDER_HANDOFF_RECAP.md) | LLM provider and chat-preview implementation notes |

---

## Guides & Runbooks

| Document | Description |
|---|---|
| [docs/runbooks/TESTABLE_STEPS.md](runbooks/TESTABLE_STEPS.md) | Testable steps per milestone |
| [docs/runbooks/PRODUCTION_HARDENING_PLAN.md](runbooks/PRODUCTION_HARDENING_PLAN.md) | Production hardening and deployment safety guidance |
| [docs/runbooks/BETA_LAUNCH_HARDENING_PLAN.md](runbooks/BETA_LAUNCH_HARDENING_PLAN.md) | Beta-readiness checklist |
| [docs/guides/LOCAL_DOCKER_START.md](guides/LOCAL_DOCKER_START.md) | Local Docker workflow for dev and deploy-like stacks |
| [docs/guides/AGENT_RELEASE_CHECKLIST.md](guides/AGENT_RELEASE_CHECKLIST.md) | Release and branch checklist for agents |
| [docs/guides/GITFLOW_RELEASE_POLICY.md](guides/GITFLOW_RELEASE_POLICY.md) | Gitflow branch semantics and release policy |
| [docs/guides/PUBLIC_REPO_CHECKLIST.md](guides/PUBLIC_REPO_CHECKLIST.md) | Public repository safety and sanitization checklist |
| [docs/guides/OPENROUTER_INTEGRATION_GUIDE.md](guides/OPENROUTER_INTEGRATION_GUIDE.md) | OpenRouter setup and multi-provider notes |
| [docs/guides/I18N.md](guides/I18N.md) | Internationalization guide and translation workflow |

---

## Core Technical Specifications

| Document | Description |
|---|---|
| [docs/specs/SPEC.md](specs/SPEC.md) | Backend API platform and MVP architecture |
| [docs/specs/DB_PLATFORM_SPEC.md](specs/DB_PLATFORM_SPEC.md) | MongoDB schema design, publication model, and credit system |
| [docs/specs/PROVIDER_SPEC.md](specs/PROVIDER_SPEC.md) | Multi-provider LLM integration contract |
| [docs/specs/PREPROMPT_ENGINE_SPEC.md](specs/PREPROMPT_ENGINE_SPEC.md) | Preprompt engine service and composition flow |
| [docs/specs/WORKFLOWS.md](specs/WORKFLOWS.md) | Automated workflow definitions WF-01 to WF-10 |
| [docs/specs/UX_SPEC.md](specs/UX_SPEC.md) | End-to-end UX and product screen map |
| [docs/specs/EXECUTION_LOG_SPEC.md](specs/EXECUTION_LOG_SPEC.md) | Structured operational audit logging |
| [docs/specs/FOCUSED_EDIT_SPEC.md](specs/FOCUSED_EDIT_SPEC.md) | Focused editing behavior and constraints |

---

## Feature Specifications

| Document | Description |
|---|---|
| [docs/specs/EXPORT_AND_PUBLISH_SPEC.md](specs/EXPORT_AND_PUBLISH_SPEC.md) | ZIP export and web publishing model |
| [docs/specs/UX_REVIEW_AND_PUBLISH_SPEC.md](specs/UX_REVIEW_AND_PUBLISH_SPEC.md) | Review workspace and publish flow |
| [docs/specs/WYSIWYG_EDIT_MODE_SPEC.md](specs/WYSIWYG_EDIT_MODE_SPEC.md) | WYSIWYG editor architecture and milestones |
| [docs/specs/ONBOARDING_AND_STYLE_PROFILING_SPEC.md](specs/ONBOARDING_AND_STYLE_PROFILING_SPEC.md) | Onboarding, style profiling, and Layer 0 context |
| [docs/specs/PRESET_TYPED_SPECS.md](specs/PRESET_TYPED_SPECS.md) | Preset catalog, output contracts, and prompt modules |
| [docs/specs/SECTION_CONTEXT_OPT_SPEC.md](specs/SECTION_CONTEXT_OPT_SPEC.md) | Section-aware context optimization |
| [docs/specs/PROMPT_OPTIMIZER_SPEC.md](specs/PROMPT_OPTIMIZER_SPEC.md) | Prompt optimizer UX and guardrails |
| [docs/specs/PROMPTING_SERVICE_PLATFORM_SPEC.md](specs/PROMPTING_SERVICE_PLATFORM_SPEC.md) | Internal prompting platform and audit model |
| [docs/specs/MULTIMODE_UX_MVP_EXECUTION_SPEC.md](specs/MULTIMODE_UX_MVP_EXECUTION_SPEC.md) | Ultra-operational MVP spec for Zero Effort + GodMode, shared orchestration, and parallel implementation waves |
| [docs/specs/ASSET_AWARE_CONTEXT_ENRICHMENT_SPEC.md](specs/ASSET_AWARE_CONTEXT_ENRICHMENT_SPEC.md) | Asset-aware prompt enrichment plan |
| [docs/specs/IMAGE_PROMPTING_PIPELINE_SPEC.md](specs/IMAGE_PROMPTING_PIPELINE_SPEC.md) | Structured image prompting, context enrichment, and versioning-aligned pipeline |
| [docs/specs/BAAS_SERVICES_SPEC.md](specs/BAAS_SERVICES_SPEC.md) | Backend-as-a-service extension layer |
| [docs/specs/RAG_CHATBOT_SPEC.md](specs/RAG_CHATBOT_SPEC.md) | RAG chatbot integration for generated sites |
| [docs/specs/MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md](specs/MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md) | Multi-model platform playbook |
| [docs/specs/SUPER_ADMIN_SPEC.md](specs/SUPER_ADMIN_SPEC.md) | Superadmin controls and platform governance |

---

## Governance Controls

| Document | Description |
|---|---|
| [docs/specs/SUPER_ADMIN_SPEC.md](specs/SUPER_ADMIN_SPEC.md) | Product-level prompt, injection, and runtime governance model |
| [docs/governance/PLATFORM_GOVERNANCE_POLICY.md](governance/PLATFORM_GOVERNANCE_POLICY.md) | Governance ownership, approval flow, and audit expectations |

> If you add, move, or retire documentation, update this index in the same change.
