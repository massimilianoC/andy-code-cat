# Workspace refactoring review — 2026-07-13

## Decision

The branch is salvageable, but the pending all-at-once extraction was rejected.

The accepted refactoring scope is intentionally incremental:

1. keep `WorkspaceLayoutContext` for layout-only state;
2. extract publish, unpublish, export, capture, and slug behavior into the typed `usePublish` feature controller;
3. extract deterministic message, focus/media, and preview URL utilities into feature-local modules;
4. keep chat, editor, project, and LLM state in the existing workspace page until each boundary has dedicated characterization tests.

The rejected spike introduced three additional contexts plus a `WorkspaceChatPanel` with 115 untyped props. It also mounted none of those providers, causing `/workspace/[projectId]` to fail at runtime. Those files and the temporary extraction scripts were removed.

## Comparison baseline

Two baselines were used:

- `HEAD` before the pending extraction: behavioral oracle for the current workspace;
- `develop`: Gitflow integration baseline for the branch.

The branch is based on `develop`; comparing this refactor to `main` would include unrelated Gitflow divergence.

## Preserved behavior

| Area | Pre-refactor behavior | Refactored behavior |
| --- | --- | --- |
| Horizontal workspace split | Default 40%, clamp 25–60%, persisted by cookie | Unchanged |
| Vertical chat split | Default 65%, clamp 30–85%, persisted by cookie | Unchanged |
| Preview tabs and viewport | Local workspace state | Same state owned by layout context |
| Export and capture | Local callbacks in the page | Same callbacks owned by `usePublish` |
| Publish/unpublish | Active backend snapshot semantics | Unchanged |
| Custom slug | Same validation, debounce, and API error mapping | Unchanged |
| Chat/editor/project/LLM | Local state and rendering | Deliberately unchanged |

The publish controller exposes four cohesive groups (`export`, `capture`, `publish`, and `slug`) rather than leaking internal React setters back into the route component. Page-level slug removal and toggle logic now use semantic controller commands.

## Rejected approach

The following extraction was removed rather than repaired in place:

- `WorkspaceChatPanel`;
- standalone `MessageBubble`;
- `WorkspaceProjectContext`;
- `WorkspaceLLMContext`;
- `WorkspaceEditorContext`.

Reasons:

- runtime provider regression;
- 115-value prop surface typed as `any`;
- duplicated and unused context dependencies;
- excessive change surface without characterization tests;
- no meaningful reduction in coupling.

This code should be revisited only after the chat boundary has a typed façade and browser tests for sending, streaming, attachments, media inspection, focused editing, and didactic mode.

## Validation

The final review gate requires:

- `npm run build -w apps/web`;
- `git diff --check HEAD`;
- a Playwright smoke test against the freshly built app, using an isolated bot project;
- verification that the workspace shell and chat panel render without client exceptions;
- verification that the persisted 60% horizontal and 85% vertical boundary values survive reload.

The permanent characterization suite is `tests/e2e/workspace-refactor.spec.ts`. `E2E_BASE_URL` and `E2E_API_URL` allow it to target a freshly built app on a free port without replacing the active Docker web service.

The report must only claim the results produced by the final working tree. It does not treat a successful TypeScript build as proof of runtime behavior.

Final results:

- production Next.js build: passed;
- workspace route bundle: 60.2 kB on the host build and 60.1 kB in the Docker build (no meaningful runtime overhead increase);
- permanent Playwright characterization suites: 6 tests passed;
- deploy-stack web image: rebuilt and deployed with `docker-compose.deploy.yml` using `--no-deps`;
- workspace route on the freshly deployed app: HTTP 200;
- API health after web-only deployment: HTTP 200;
- workspace shell and chat panel: visible;
- client-side provider/context exceptions: none;
- persisted horizontal split at 60%: preserved after reload;
- persisted vertical split at 85%: preserved after reload;
- disposable E2E bot project: deleted after the smoke test.

The God Mode handoff now uses reactive model-resolution state before firing the pending prompt. This closes a race where a preferred provider/model already equal to the selected default updated only a ref and never retriggered auto-generation. An unavailable preferred model also falls back to the active default instead of leaving the handoff pending indefinitely. The dedicated host-side characterization test verifies that the prompt stored by Zero Effort is consumed and sent automatically.

Local publish links no longer force the build-time API origin (`localhost:4000`). The workspace resolves the relative deployment path through the local nginx front-door, while publish and republish normalize persisted absolute `/p/media/*` URLs to same-origin paths. This keeps CSS, JavaScript, and project media portable across direct local access, nginx, LAN access, and production API origins.

The historical preview robustness suite now creates two deterministic snapshots before asserting iframe content and version switching. It deletes only its own project, so parallel E2E workers cannot remove each other's fixtures.

## Residual risk

The workspace page remains large, but it no longer owns deterministic formatting, focus normalization, or preview asset resolution. This is intentional: reducing line count is not worth changing runtime behavior without adequate tests. Future extractions should be one responsibility at a time, keep feature contracts typed and grouped, and add characterization coverage before moving state or rendering. Pure feature modules are preferred when a responsibility does not need React state; new contexts are justified only when multiple independently rendered consumers need the same state.
