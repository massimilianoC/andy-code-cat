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
| --- | --- |
| [README.md](../README.md) | Public project overview, quick start, and positioning |
| [docs/DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) | Current development-state summary: `R1` delivered, `R2`/`R3` active, live cross-cutting tracks |
| [docs/project/ROADMAP.md](project/ROADMAP.md) | Project roadmap and release direction |
| [docs/project/WORKFLOW_PIPELINE_MODULARIZATION_PLAN.md](project/WORKFLOW_PIPELINE_MODULARIZATION_PLAN.md) | Reuse-first implementation plan for zero-effort flows, backend orchestration, and future node-based pipelines |
| [docs/PRIVATE_CONFIG_GUIDE.md](PRIVATE_CONFIG_GUIDE.md) | Owner-only guidance for public/private repo hygiene |

---

## Architecture

| Document | Description |
| --- | --- |
| [docs/architecture/BOOTSTRAP_ARCHITECTURE.md](architecture/BOOTSTRAP_ARCHITECTURE.md) | Current implementation shape: services, route surface, frontend modes, media/storage, and governance baseline |
| [docs/architecture/PIPELINE_LAYERS.md](architecture/PIPELINE_LAYERS.md) | Layer 1 preview flow, Layer 2 generation pipeline, and transition mechanics |
| [docs/security/SECURITY_BASELINE.md](security/SECURITY_BASELINE.md) | Auth baseline, tenant isolation, and operational security rules |

---

## Agent Navigation

| Document | Description |
| --- | --- |
| [docs/agents/CODE_AGENT_INDEX.md](agents/CODE_AGENT_INDEX.md) | Primary entry point for coding agents |
| [docs/agents/LLM_PROVIDER_HANDOFF_RECAP.md](agents/LLM_PROVIDER_HANDOFF_RECAP.md) | LLM provider and chat-preview implementation notes |
| [docs/agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md](agents/PROMPTING_PIPELINE_AGENT_GUARDRAILS.md) | Layer ownership map and collision-prevention rules for parallel agents |

---

## Guides & Runbooks

| Document | Description |
| --- | --- |
| [docs/runbooks/TESTABLE_STEPS.md](runbooks/TESTABLE_STEPS.md) | Baseline checks plus current active validation tracks and deferred backlog verification steps |
| [docs/runbooks/PRESET_RESEED.md](runbooks/PRESET_RESEED.md) | Local, deploy-stack, and Droplet procedure for reseeding project template models from the static preset catalog |
| [docs/runbooks/CDN_COMPATIBILITY.md](runbooks/CDN_COMPATIBILITY.md) | Verified CDN whitelist and compatibility notes for generated interactive, game, 3D, and VR artifacts |
| [docs/runbooks/PRODUCTION_HARDENING_PLAN.md](runbooks/PRODUCTION_HARDENING_PLAN.md) | Production hardening and deployment safety guidance |
| [docs/runbooks/BETA_LAUNCH_HARDENING_PLAN.md](runbooks/BETA_LAUNCH_HARDENING_PLAN.md) | Beta-readiness checklist |
| [install.sh](../install.sh) | Self-configuring one-file installer — local and domain modes, auto SSL via certbot |
| [docs/guides/LOCAL_DOCKER_START.md](guides/LOCAL_DOCKER_START.md) | Local Docker workflow for dev and deploy-like stacks |
| [docs/guides/AGENT_RELEASE_CHECKLIST.md](guides/AGENT_RELEASE_CHECKLIST.md) | Release and branch checklist for agents |
| [docs/guides/GITFLOW_RELEASE_POLICY.md](guides/GITFLOW_RELEASE_POLICY.md) | Gitflow branch semantics and release policy |
| [docs/guides/PUBLIC_REPO_CHECKLIST.md](guides/PUBLIC_REPO_CHECKLIST.md) | Public repository safety and sanitization checklist |
| [docs/guides/OPENROUTER_INTEGRATION_GUIDE.md](guides/OPENROUTER_INTEGRATION_GUIDE.md) | OpenRouter setup and multi-provider notes |
| [docs/guides/I18N.md](guides/I18N.md) | Internationalization guide and translation workflow |
| [docs/guides/LLM_JSON_PARSING_GUIDELINES.md](guides/LLM_JSON_PARSING_GUIDELINES.md) | Reusable guide: parsing, repair, and normalization of LLM JSON output |
| [docs/guides/MULTIPROVIDER_LLM_BEST_PRACTICES.md](guides/MULTIPROVIDER_LLM_BEST_PRACTICES.md) | Best practices for multi-provider LLM systems: catalog, routing, cost, background tasks, image gen |

---

## Core Technical Specifications

| Document | Description |
| --- | --- |
| [docs/specs/SPEC.md](specs/SPEC.md) | Backend API platform and MVP architecture |
| [docs/specs/DB_PLATFORM_SPEC.md](specs/DB_PLATFORM_SPEC.md) | MongoDB schema design, publication model, and credit system |
| [docs/specs/COST_TRANSACTION_LEDGER_SPEC.md](specs/COST_TRANSACTION_LEDGER_SPEC.md) | Centralized cost-transaction ledger — atomic per-event billing, configurable rates, policy enforcement, and SuperAdmin cost UI |
| [docs/specs/COST_ANALYTICS_DASHBOARDS_SPEC.md](specs/COST_ANALYTICS_DASHBOARDS_SPEC.md) | User Usage tab and Admin Cost Intelligence dashboard — multi-dimensional cost explorer across providers, models, users, and projects |
| [docs/specs/PROVIDER_SPEC.md](specs/PROVIDER_SPEC.md) | Multi-provider LLM integration contract |
| [docs/specs/PREPROMPT_ENGINE_SPEC.md](specs/PREPROMPT_ENGINE_SPEC.md) | Preprompt engine service and composition flow |
| [docs/specs/WORKFLOWS.md](specs/WORKFLOWS.md) | Automated workflow definitions WF-01 to WF-10 |
| [docs/specs/UX_SPEC.md](specs/UX_SPEC.md) | End-to-end UX and product screen map |
| [docs/specs/EXECUTION_LOG_SPEC.md](specs/EXECUTION_LOG_SPEC.md) | Structured operational audit logging |
| [docs/specs/FOCUSED_EDIT_SPEC.md](specs/FOCUSED_EDIT_SPEC.md) | Focused editing behavior and constraints |

---

## Feature Specifications

| Document | Description |
| --- | --- |
| [docs/specs/EXPORT_AND_PUBLISH_SPEC.md](specs/EXPORT_AND_PUBLISH_SPEC.md) | ZIP export and web publishing model |
| [docs/specs/I18N_ARTIFACTS_SPEC.md](specs/I18N_ARTIFACTS_SPEC.md) | Multilingual support for LLM-generated artifact websites — post-publication translation pipeline |
| [docs/specs/UX_REVIEW_AND_PUBLISH_SPEC.md](specs/UX_REVIEW_AND_PUBLISH_SPEC.md) | Review workspace and publish flow |
| [docs/specs/WYSIWYG_EDIT_MODE_SPEC.md](specs/WYSIWYG_EDIT_MODE_SPEC.md) | WYSIWYG editor architecture and milestones |
| [docs/specs/ONBOARDING_AND_STYLE_PROFILING_SPEC.md](specs/ONBOARDING_AND_STYLE_PROFILING_SPEC.md) | Onboarding, style profiling, and Layer 0 context |
| [docs/specs/PRESET_TYPED_SPECS.md](specs/PRESET_TYPED_SPECS.md) | Preset catalog, output contracts, and prompt modules |
| [docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md](specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md) | Target architecture for structured LLM media manifests, deterministic backend media resolution, provider policy, asset persistence, notifications, and snapshot/publish guardrails |
| [docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_GAPS.md](specs/ARTIFACT_MEDIA_ORCHESTRATOR_GAPS.md) | Implementation-ready backlog of remaining gaps against the Artifact Media Orchestrator spec (per-gap files, fix, acceptance, effort) |
| [docs/specs/MINIMAX_M3_CONVERSATION_MEDIA_PARITY_SPEC.md](specs/MINIMAX_M3_CONVERSATION_MEDIA_PARITY_SPEC.md) | Local Docker + MongoDB analysis of a successful MiniMax M3 media-bearing run: snapshot/media success, conversation parity gap, traceability deficits, and operational plan for manual or automatic keyed media replay |
| [docs/specs/MEDIA_STRATEGY_RESOLVER_PIPELINE_SPEC.md](specs/MEDIA_STRATEGY_RESOLVER_PIPELINE_SPEC.md) | Proposed next evolution for frontend-selectable media strategies: stock search, AI image generation, project/user assets, hybrid context planning, structured JSON planner outputs, failure traces, admin UI, and Playwright E2E |
| [docs/specs/IMAGE_FETCH_PERSISTENCE_REFACTOR_PROPOSAL.md](specs/IMAGE_FETCH_PERSISTENCE_REFACTOR_PROPOSAL.md) | ⚠️ DEPRECATED / historical — Wave-1 analysis, superseded by [ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md](specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md). Kept for context only. |
| [docs/specs/SECTION_CONTEXT_OPT_SPEC.md](specs/SECTION_CONTEXT_OPT_SPEC.md) | Section-aware context optimization |
| [docs/specs/PROMPT_OPTIMIZER_SPEC.md](specs/PROMPT_OPTIMIZER_SPEC.md) | Prompt optimizer UX and guardrails |
| [docs/specs/PROMPTING_SERVICE_PLATFORM_SPEC.md](specs/PROMPTING_SERVICE_PLATFORM_SPEC.md) | Internal prompting platform and audit model |
| [docs/specs/LLM_PROVIDER_CATALOG_ALIGNMENT_SPEC.md](specs/LLM_PROVIDER_CATALOG_ALIGNMENT_SPEC.md) | Summary spec for provider compatibility fixes, single-source catalog alignment, shared picker UI, validation status, and review perimeter |
| [docs/specs/MULTIMODE_UX_MVP_EXECUTION_SPEC.md](specs/MULTIMODE_UX_MVP_EXECUTION_SPEC.md) | Ultra-operational MVP spec for Zero Effort + GodMode, shared orchestration, and parallel implementation waves |
| [docs/specs/ZERO_EFFORT_MEDIA_ASYNC_EVOLUTION_SPEC.md](specs/ZERO_EFFORT_MEDIA_ASYNC_EVOLUTION_SPEC.md) | Evoluzione Zero Effort: media upload step, Layer F media context nel prompt, async job tracking, notifiche email/Telegram |
| [docs/specs/ASSET_AWARE_CONTEXT_ENRICHMENT_SPEC.md](specs/ASSET_AWARE_CONTEXT_ENRICHMENT_SPEC.md) | Asset-aware prompt enrichment plan |
| [docs/specs/DOCUMENT_CONTEXT_LAYER_SPEC.md](specs/DOCUMENT_CONTEXT_LAYER_SPEC.md) | Document Context Layer — PDF/DOCX parsing, image vision analysis, AssetEnrichmentTrace envelope, and Layer D prompt injection |
| [docs/specs/IMAGE_PROMPTING_PIPELINE_SPEC.md](specs/IMAGE_PROMPTING_PIPELINE_SPEC.md) | Structured image prompting, context enrichment, and versioning-aligned pipeline |
| [docs/specs/BAAS_SERVICES_SPEC.md](specs/BAAS_SERVICES_SPEC.md) | Backend-as-a-service extension layer |
| [docs/specs/RAG_CHATBOT_SPEC.md](specs/RAG_CHATBOT_SPEC.md) | RAG chatbot integration for generated sites |
| [docs/specs/MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md](specs/MULTIPROVIDER_MULTIMODEL_PLATFORM_PLAYBOOK.md) | Multi-model platform playbook |
| [docs/specs/SUPER_ADMIN_SPEC.md](specs/SUPER_ADMIN_SPEC.md) | Superadmin controls and platform governance |
| [docs/specs/FIRST_INSTALL_SETUP_SPEC.md](specs/FIRST_INSTALL_SETUP_SPEC.md) | First-install wizard, guided server config, superadmin seed, emergency DB promotion |
| [docs/specs/MULTIDOMAINS_IMPLEMENTATION_PLAN.md](specs/MULTIDOMAINS_IMPLEMENTATION_PLAN.md) | Multi-domain deployment implementation plan — R3.1–R3.4, nginx vhost generation, SSL automation, domain admin API/UI |
| [docs/specs/USER_SETTINGS_AND_API_KEYS_SPEC.md](specs/USER_SETTINGS_AND_API_KEYS_SPEC.md) | R3.5 — User-owned API keys (programmatic access) and unified role-scoped settings panel |
| [docs/specs/DASHBOARD_LOVABLE_CHAT_SPEC.md](specs/DASHBOARD_LOVABLE_CHAT_SPEC.md) | Dashboard Lovable Chat — ChatPanel reusable component, entry-point chat, and LLM intent-to-template classifier |
| `apps/web/app/admin/experimental/data-dashboard/[projectId]/page.tsx` | Superadmin-only alpha console for the grounded dataset runtime: deterministic queries, browsing, insights, and dashboard experimentation detached from the main UX |
| [docs/specs/DATA_DASHBOARD_NATIVE_INTEGRATION_STRATEGY.md](specs/DATA_DASHBOARD_NATIVE_INTEGRATION_STRATEGY.md) | Alpha-only strategy for the grounded dataset runtime and possible future re-integration, currently detached from the primary Vibe / Zero Effort UX |
| [docs/specs/PUBLISHED_DATASET_BINDINGS_SPEC.md](specs/PUBLISHED_DATASET_BINDINGS_SPEC.md) | Decision spec for publish-time dataset bindings: original source vs normalized local runtime vs backend query endpoints, with hybrid-mode recommendation, manifest contract, exposure policies, and serial/parallel delivery plan |
| [docs/specs/ZERO_EFFORT_PREFILL_SPEC.md](specs/ZERO_EFFORT_PREFILL_SPEC.md) | Zero Effort LLM Prefill — one-pass LLM pre-population of all Zero Effort wizard fields, token counter, AI review card, God Mode one-click generation |
| [docs/specs/GLOBAL_BRAND_IDENTITY_SPEC.md](specs/GLOBAL_BRAND_IDENTITY_SPEC.md) | Global Brand Identity System — hierarchical (platform → user → project) additive brand-asset injection via Layer G; reuses existing storage, auth, and route infrastructure; retrocompatible new layer |

## VibeCore Components (feat/dashboard-lovable-chat)

| Path | Description |
| --- | --- |
| `apps/web/components/dashboard/VibeCoreEntry.tsx` | Full-screen glass card entry — classifier-led textarea intake, file drag-drop, phase state machine, Layer Φ classify → createProject → upload → redirect |
| `apps/web/components/dashboard/VibeCoreBackground.tsx` | CSS-only SVG blob background (4 ellipses, 45–60 s drift, feGaussianBlur) |
| `apps/web/components/dashboard/ModeSelector.tsx` | Segmented EASY / MEDIUM / HARD pill with per-mode glow ring |
| `apps/web/components/dashboard/ScrollBlurOverlay.tsx` | Fixed overlay that fades + blurs the VibeCore section as user scrolls down |
| `apps/web/hooks/useScrollRatio.ts` | Hook returning scroll progress ratio (0–1) between two pixel offsets |
| `apps/web/lib/api/vibecore.ts` | Web client for `GET /v1/vibecore/config`, `POST /v1/vibecore/classify`, and `POST /v1/vibecore/prefill` |
| `packages/contracts/src/vibecore.ts` | Shared VibeCore types: `FormatHint`, `AttachmentMeta`, `VibeClassifyRequest/Response` |
| `apps/api/src/application/use-cases/VibeClassify.ts` | Layer Φ intent + format classifier use-case (LLM call, confidence threshold, graceful skip) |
| `apps/api/src/application/use-cases/VibePrefill.ts` | Structured Zero Effort brief prefill use-case with optional Layer D document context |
| `apps/api/src/application/prompting/formatHintRules.ts` | Format hint catalog (7 categories) and template list block builder |
| `apps/api/src/presentation/http/routes/vibecoreRoutes.ts` | `GET /v1/vibecore/config` + `POST /v1/vibecore/classify` + `POST /v1/vibecore/prefill` — auth-protected, project-aware vibe entry surface |

---

## Test Reports

| Document | Description |
| --- | --- |
| [docs/reports/E2E_DCL_REPORT_2026-05-14.md](reports/E2E_DCL_REPORT_2026-05-14.md) | Autonomous E2E session — DCL pipeline, Zero Effort flow, Layer D verification, 5 bugs found and fixed |
| [docs/reports/ARTIFACT_MEDIA_IMPLEMENTATION_STATUS_2026-05-29.md](reports/ARTIFACT_MEDIA_IMPLEMENTATION_STATUS_2026-05-29.md) | Current implementation certification for Artifact Media Orchestrator: verified defaults, Docker smoke status, file map, human-test path, open gaps, and future development anchors |
| [docs/reports/MINIMAX_M3_PARITY_IMPLEMENTATION_2026-06-02.md](reports/MINIMAX_M3_PARITY_IMPLEMENTATION_2026-06-02.md) | Wave-1 implementation report for MiniMax M3 conversation/media parity: message-to-snapshot linkage, first-class asset lineage, MongoDB query paths, and audit correlation strategy |
| [docs/reports/DATA_DASHBOARD_ARCHITECTURAL_STATUS_2026-06-04.md](reports/DATA_DASHBOARD_ARCHITECTURAL_STATUS_2026-06-04.md) | Architectural report for the grounded data-dashboard work: implementation status, integration with the native generative pipeline, additive vs native boundaries, and remaining convergence gaps toward public runtime completion |
| [docs/reports/DATA_DASHBOARD_ALPHA_RESCOPING_2026-06-05.md](reports/DATA_DASHBOARD_ALPHA_RESCOPING_2026-06-05.md) | Scope-correction report: detach data-dashboard from the main UX, keep it admin-experimental only, and clarify what runtime value is reusable for Layer D vs what remains separate |

---

## Governance Controls

| Document | Description |
| --- | --- |
| [docs/specs/SUPER_ADMIN_SPEC.md](specs/SUPER_ADMIN_SPEC.md) | Product-level prompt, injection, and runtime governance model |
| [docs/specs/FIRST_INSTALL_SETUP_SPEC.md](specs/FIRST_INSTALL_SETUP_SPEC.md) | First-install wizard and initial platform configuration |
| [docs/governance/PLATFORM_GOVERNANCE_POLICY.md](governance/PLATFORM_GOVERNANCE_POLICY.md) | Governance ownership, approval flow, and audit expectations |

> If you add, move, or retire documentation, update this index in the same change.

---

## Deprecated Specs Archive

| Document | Replacement |
| --- | --- |
| [docs/archive/specs/IMAGE_PICKER_SPEC.deprecated.md](archive/specs/IMAGE_PICKER_SPEC.deprecated.md) | Superseded by [docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md](specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md) |
| [docs/archive/specs/EXTERNAL_API_KEYS_PLATFORM_SPEC.deprecated.md](archive/specs/EXTERNAL_API_KEYS_PLATFORM_SPEC.deprecated.md) | Image-provider governance superseded by [docs/specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md](specs/ARTIFACT_MEDIA_ORCHESTRATOR_SPEC.md); general API-key/BYOK ideas are historical only |
