# Andy Code Cat - Product Vision

> Status: current product vision  
> Last aligned: 2026-07-15
> Supersedes: historical vision archived at `docs/archive/vision/TARGET-VISION_2026-05-14.md`

Andy Code Cat is evolving from an AI website builder into a no-code / low-code artifact
generation platform for interactive digital communication.

The core product is a shared engine that turns a natural-language request, uploaded files,
brand context, and a selected or inferred template into a publishable interactive artifact.
Artifacts can be landing pages, mini-sites, slide decks, posters, visual one-pagers, data
dashboards, small HTML/JavaScript games, 3D/WebXR scenes, and future media containers.

The product must remain one platform, not a set of separate generators. Every entry mode
must converge on the same project, asset, snapshot, prompt trace, export, and publish model.

---

## Current Product Shape

The current platform already includes the foundations needed for this vision:

- authenticated multi-project usage with double sandbox isolation
- preset-aware and layered prompt composition
- VibeCore / Guided Mode intake with intent classification and guided handoff
- document and media context through `enrichmentTrace` and Layer D
- user style profile, moodboard, and global brand identity layers
- WYSIWYG and code editing over generated HTML/CSS/JS artifacts
- snapshot versioning, export ZIP, path-based publish, and public media serving
- Didactic Mode for read-only artifact interrogation, Q&A, and quizzes
- execution logs, cost foundations, notifications, and media-resolution traces

The product should now be understood as an artifact platform with multiple front doors:

- **VibeCore / Guided Mode** for fast guided generation
- **Workspace / Workspace** for expert iterative control
- **Didactic Mode** for understanding what the AI produced and why
- **Admin / Governance** for templates, prompt layers, model routing, and platform policy

---

## Direction Lock - July 2026

The next quality leap is not another generic prompt layer. It is a template-specific knowledge
layer that improves output craft for each artifact family.

### Point 1 - Stabilize The Existing Platform

Before widening the runtime surface, R2/R3 must be regression-protected:

- generation, media resolution, snapshot activation, export, and publish must have visible logs
- project-level cost and usage must be inspectable by owners and admins
- path publish, slug management, and future domain work must be covered by smoke tests
- VibeCore -> upload -> enrichment -> launch -> workspace -> export/publish must be testable end to end

### Point 2 - Template Skills Layer

Template skills are Markdown manuals attached to presets, viewport models, and tags.
They teach the generation model how to build a specific artifact type well without bloating
universal Layer A rules or duplicating instructions across presets.

Examples:

- playable game loops, pointer/touch fallback, physics patterns
- accessible slide decks and keyboard/touch navigation
- responsive SVG composition and animation
- Chart.js dashboards with accessible fallbacks
- Three.js scenes with camera, resize, lighting, and render loop rules
- A-Frame/WebXR scenes with cursor/raycaster interaction

This is implemented through filesystem-backed `Layer S` (`template-skills`), which reads
Markdown manuals from `docs/skills/template-skills/by-template/<presetId>/` through the same
prompt composition path used by preview and real generation.

---

## Backend Services Vision

Andy Code Cat should remain frontend-artifact-first for now.

When dynamic behavior is needed, the recommended direction is a shared declarative BaaS layer,
not generated per-artifact backend code and not one database instance per generated app.

Generated artifacts should declare service needs through a `serviceManifest` and declarative DOM
markers. Versioned, platform-owned runtime modules—not LLM-generated handlers—call approved
capability APIs for forms, catalog, payments or future widgets. Email, Telegram, CRM and webhook
actions originate from validated server-side events rather than generic anonymous trigger APIs.
The real backend stays inside Andy Code Cat and enforces:

- project public key resolution
- origin allowlist from publish state
- rate limiting
- strict DTO validation
- user/project ownership for management APIs
- envelope encryption for BYOK secrets
- execution logging and abuse monitoring

Persistent capabilities use shared domain collections with mandatory
`ownerUserId + projectId + capabilityInstanceId` scope in every repository query. A physical
database/cluster per tenant is an optional enterprise isolation tier, not the default, and a
collection per tenant in one database is explicitly rejected. The current decision and rollout
order live in [PLATFORM_CAPABILITY_RUNTIME.md](../architecture/PLATFORM_CAPABILITY_RUNTIME.md).

This keeps the artifact portable while giving it safe dynamic capabilities.

---

## Artifact Structure Direction

The artifact model should remain backward-compatible with the current `html/css/js` triple, but
future iterations should allow a richer folder contract:

```text
artifact/
  artifacts.html
  artifacts.css
  artifacts.js
  manifest.json
  mediaManifest.json
  serviceManifest.json
  assets/
  didactic/
  prompt-trace.json
```

The first implementation should not require this full structure. It should be introduced
incrementally, starting with metadata that already exists: media manifests, prompt traces,
snapshot metadata, and future service manifests.

---

## Deferred Areas

These remain valid but should not displace the current R2/R3 and Template Skills work:

- full BaaS services layer beyond a first Forms service
- per-artifact custom backend execution
- RAG chatbot for published visitors
- workflow/node editor execution
- user-generated private skills and marketplace-style sharing
- real-time collaboration

The system should first become reliably observable, publishable, and measurably better at
artifact quality through template skills.
