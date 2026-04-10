# Project Roadmap

Andy Code Cat is developed in iterative releases. Each release is a shippable, testable increment.

---

## Current Status: R0 (Bootstrap + Core AI Loop)

The core platform is operational:

- [x] Docker Compose stack (API + Web + MongoDB + Redis + nginx)
- [x] JWT authentication (register / login / refresh)
- [x] Project CRUD with owner isolation (double sandbox)
- [x] Multi-provider LLM catalog (SiliconFlow, OpenRouter, LM Studio)
- [x] AI page generation via chat (Layer 1 — Chat Preview)
- [x] GrapesJS visual editor (WYSIWYG)
- [x] Focused edit — AI edits a selected section within the full page context
- [x] Section-aware context optimization (40–60% token reduction)
- [x] Export to static HTML (ZIP download)
- [x] Path-based publish (`/p/{publishId}`)
- [x] Per-session cost tracking (EUR, with USD→EUR conversion)
- [x] Onboarding wizard (style profiling, tag taxonomy)
- [x] Prompt optimizer (inline enrichment)
- [x] i18n foundation (IT/EN)
- [x] Typed preset catalog (A4, slide, form, infographic...)

---

## R1 — Prompt Architecture & Preset Layer

- [ ] Layer 2 PrepromptEngine — modular prompt injection (architectural constraints, output format, style context, template)
- [ ] Preset-aware generation — output spec per preset type (page size, responsiveness, content blocks)
- [ ] Style context propagation — user tag profile feeds Layer 0 preprompt
- [ ] Extended model selector UI (provider + model per session)

---

## R2 — Execution Logging & Observability

- [ ] `execution_logs` collection (MongoDB TTL 90d)
- [ ] Per-operation log events: generation, focused edit, export, publish, optimizer
- [ ] Admin/owner log query endpoint
- [ ] Cost dashboard per project

---

## R3 — Subdomain Publishing & Domain Management

- [ ] Wildcard subdomain publish (`{slug}.yourdomain.com`)
- [ ] Custom domain mapping (BYOD — bring your own domain)
- [ ] nginx dynamic vhost generation
- [ ] SSL automation (Let's Encrypt)

---

## R4 — BaaS Services Layer

- [ ] Forms service (collect form submissions from published pages)
- [ ] Payments BYOK (Stripe Connect passthrough)
- [ ] Webhook relay
- [ ] Shared service catalog (injectable into published pages as vanilla JS)
- [ ] Envelope encryption for BYOK API secrets (AES-256-GCM)

---

## R5 — RAG Chatbot Integration

- [ ] RAG chatbot for landing pages (BYOK Flowise/n8n/generic)
- [ ] Document ingestion from asset manager
- [ ] Secure BaaS proxy
- [ ] Visitor rate limiting

---

## Out of Scope (for now)

- SaaS multi-tenant billing (no plans for hosted SaaS)
- Mobile app
- Real-time collaboration

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to get involved.
Detailed specs for each feature are in [`docs/specs/`](docs/specs/).
