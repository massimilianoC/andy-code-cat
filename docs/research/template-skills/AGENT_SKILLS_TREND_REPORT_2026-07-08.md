# Agent Skills Trend Report - Template Skills

> Date: 2026-07-08  
> Scope: online research for declarative skill/manual systems that can improve agentic artifact quality in Andy Code Cat  
> Output: first seed catalog under `docs/skills/template-skills/seed-catalog/`

---

## Summary

The current agent tooling trend is moving from one large static prompt toward small,
discoverable, reusable instruction packages.

For Andy Code Cat, this maps directly to the planned `Layer S` (`template-skills`):
template-specific Markdown manuals that are selected by `presetId`, `viewportModel`, and tags,
then injected next to Layer B. This should improve artifact quality without turning universal
constraints into a brittle mega-prompt.

---

## Source Signals

| Source | Signal | Relevance for Andy |
| --- | --- | --- |
| Anthropic Agent Skills docs: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview | Skills are custom instruction packages loaded when relevant. | Confirms that skill manuals should be modular and task-scoped. |
| Anthropic engineering post: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills | Skills package instructions, scripts, and resources into reusable folders. | Supports Andy's plan for Markdown manuals plus optional future resources. |
| `anthropics/skills`: https://github.com/anthropics/skills | Public examples of folder-based agent skills. | Good reference for portable skill folder layout. |
| VS Code Agent Skills docs: https://code.visualstudio.com/docs/agent-customization/agent-skills | Skills can be copied into local folders and reviewed/customized. | Reinforces plain-file portability and operator review. |
| OpenAI Agents SDK docs: https://openai.github.io/openai-agents-python/ | Production agents emphasize tools, guardrails, orchestration, and observability. | Andy should keep skills declarative and leave real execution in backend services. |
| OpenAI Agents SDK tools docs: https://openai.github.io/openai-agents-python/tools/ | Namespaces and deferred loading reduce token pressure. | `Layer S` should be budget-capped and selected, not always injected. |
| GitHub Copilot AGENTS.md guidance: https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/ | Repository instructions work best when scoped, concrete, and tested. | Template skills should contain explicit do/don't rules and acceptance checks. |
| `awesome-copilot` custom agents: https://github.com/github/awesome-copilot | Agent files are reusable domain specialists. | Supports a curated library rather than ad hoc prompt text. |

---

## Domain Sources Used For Seed Skills

| Artifact family | Primary references |
| --- | --- |
| Browser game loop | MDN game anatomy: https://developer.mozilla.org/en-US/docs/Games/Anatomy; `requestAnimationFrame`: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame |
| Phaser games | Phaser input docs: https://docs.phaser.io/phaser/concepts/input |
| Slide decks / carousels | W3C WAI carousel tutorial: https://www.w3.org/WAI/tutorials/carousels/; WAI APG carousel pattern: https://www.w3.org/WAI/ARIA/apg/patterns/carousel/ |
| SVG artifacts | MDN SVG: https://developer.mozilla.org/en-US/docs/Web/SVG; `viewBox`: https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/viewBox |
| Chart.js dashboards | Chart.js accessibility: https://www.chartjs.org/docs/latest/general/accessibility.html; responsive charts: https://www.chartjs.org/docs/latest/configuration/responsive.html |
| p5.js creative canvas | p5 `windowResized`: https://p5js.org/reference/p5/windowResized/; `resizeCanvas`: https://p5js.org/reference/p5/resizeCanvas/ |
| Three.js scenes | Three.js docs/manual: https://threejs.org/docs/ and https://threejs.org/manual/ |
| A-Frame/WebXR | A-Frame interactions: https://aframe.io/docs/1.8.0/introduction/interactions-and-controllers.html; cursor docs: https://github.com/aframevr/aframe/blob/master/docs/components/cursor.md |

---

## Design Implications

1. Skills should be **narrow**. A `game-input-and-loop` skill should not also define branding,
   typography, or publish rules.
2. Skills should be **selected**, not globally injected. Use `presetIds`, `viewportModels`, and
   tags to keep prompt budget under control.
3. Skills should be **whole-block budgeted**. Drop lower-priority skills before truncating a
   manual mid-rule.
4. Skills should be **operator-governed** first. User-scoped or marketplace skills can come later.
5. Skills should include **acceptance checks** so generated artifacts can be evaluated by browser
   E2E or visual QA.
6. Skills should not expose secrets, backend access, or arbitrary external fetches. Runtime
   services belong in Andy's backend and future `serviceManifest`, not in freeform code.

---

## First Seed Selection

The first seed catalog has been created under:

`docs/skills/template-skills/seed-catalog/`

Initial manuals:

- `game-input-and-loop.md`
- `arcade-physics-phaser.md`
- `slide-deck-craft.md`
- `svg-illustration-craft.md`
- `dataviz-chartjs.md`
- `creative-canvas-p5.md`
- `webgl-scene-three.md`
- `webxr-aframe.md`

These are documentation assets only. They are not yet wired into `Layer S`.
