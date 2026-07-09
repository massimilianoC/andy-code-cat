# Template Skills Seed Catalog

> Status: filesystem-backed Layer S catalog  
> Related spec: `docs/specs/TEMPLATE_SKILLS_INJECTION_PLAN.md`  
> Research report: `docs/research/template-skills/AGENT_SKILLS_TREND_REPORT_2026-07-08.md`

This folder contains the first original Markdown manuals intended for the future
`Layer S` (`template-skills`) prompt layer.

Each file is written as a compact manual that can be injected beside the active preset layer.
The manuals are deliberately declarative: they tell the LLM what high-quality output must contain,
but they do not execute tools, store secrets, or create backend behavior.

## Folder Layout

| Path | Purpose |
| --- | --- |
| `ingestion/` | Inbox for raw manuals, notes, references, and uploaded docs awaiting classification |
| `seed-catalog/` | Canonical extracted Markdown manuals, one reusable skill per file |
| `by-template/` | Runtime source: template-specific Markdown manuals by real `ProjectPreset.id` |
| `template-skill-map.json` | Validation/documentation map for folder contents |
| `external-skill-routing.json` | Consumed-source trace from external references to local seed skills |
| `EXTERNAL_SKILL_SELECTION_2026-07-08.md` | Selection report, source attribution, consumed-source trace, and injection rationale |

## Ingestion Flow

You do not need to place skills directly into every template folder. Drop raw source files into
`ingestion/`; an agent can then extract compact manuals, place them in `seed-catalog/`,
redistribute them under `by-template/<preset-id>/`, and update `template-skill-map.json`.

Some skills should intentionally appear in more than one template folder. Duplication is allowed
when it makes template inspection and future injection easier; a canonical copy must still exist
in `seed-catalog/`.

Runtime Layer S reads `.md` files directly from `by-template/<preset-id>/`, sorted by filename.
The folder name is the unique template id and must match `ProjectPreset.id`.

After ingestion is processed, raw files should be removed. Keep only the local distilled manuals in
`seed-catalog/`, template mirrors in `by-template/`, and source attribution in the selection report
or `external-skill-routing.json`.

## Proposed Runtime Shape

```ts
interface TemplateSkill {
  id: string;
  title: string;
  body: string;
  appliesTo: {
    presetIds?: string[];
    viewportModels?: string[];
    tags?: string[];
    all?: boolean;
  };
  priority: number;
  maxChars?: number;
  isActive: boolean;
}
```

## Seed Manuals

| File | Intended matching |
| --- | --- |
| `seed-catalog/game-input-and-loop.md` | `presetIds: videogame, freerunner, seriousgame, game3d` |
| `seed-catalog/arcade-physics-phaser.md` | `presetIds: videogame, freerunner` |
| `seed-catalog/slide-deck-craft.md` | `presetIds: slideshow, keynote` |
| `seed-catalog/svg-illustration-craft.md` | `presetIds: manifesto, a4poster, infographic, keynote` |
| `seed-catalog/dataviz-chartjs.md` | `presetIds: infographic, data-dashboard` |
| `seed-catalog/creative-canvas-p5.md` | `presetIds: infographic, videogame` |
| `seed-catalog/webgl-scene-three.md` | `presetIds: game3d, vr-aframe` |
| `seed-catalog/webxr-aframe.md` | `presetIds: vr-aframe` |
| `seed-catalog/landing-conversion-copy.md` | `presetIds: landing` |
| `seed-catalog/website-information-architecture.md` | `presetIds: website` |
| `seed-catalog/form-ux-validation.md` | `presetIds: form` |
| `seed-catalog/print-layout-a4.md` | `presetIds: a4poster` |
| `seed-catalog/manifesto-editorial-rhetoric.md` | `presetIds: manifesto` |
| `seed-catalog/serious-game-learning-loop.md` | `presetIds: seriousgame` |
| `seed-catalog/interactive-story-branching.md` | `presetIds: interactive-story` |
| `seed-catalog/data-dashboard-grounded.md` | `presetIds: data-dashboard` |
| `seed-catalog/modern-impact-visual-direction.md` | `presetIds: landing, website, manifesto, a4poster, slideshow, keynote` |
| `seed-catalog/premium-landing-art-direction.md` | `presetIds: landing` |
| `seed-catalog/product-interface-craft.md` | `presetIds: website, form, infographic, data-dashboard, interactive-story` |
| `seed-catalog/anti-ai-slop-ui-review.md` | `presetIds: landing, website, form, manifesto, data-dashboard, slideshow, keynote` |
| `seed-catalog/brand-led-identity-system.md` | `presetIds: landing, website, manifesto, a4poster, infographic, keynote, interactive-story` |

## Template Folder Distribution

The same manuals are also redistributed by real preset id under:

`docs/skills/template-skills/by-template/`

Use this folder when evaluating what should be injected for one specific template. Use
`docs/skills/template-skills/template-skill-map.json` as the draft seed map for a future
hardcoded catalog or Mongo-backed association.

## Governance Notes

- Treat these files as source material for a future static `TEMPLATE_SKILL_CATALOG`.
- Do not inject all manuals globally.
- Keep secrets, provider keys, and backend behavior out of skills.
- Add/update a reseed runbook when the runtime catalog is implemented.
