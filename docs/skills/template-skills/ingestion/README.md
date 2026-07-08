# Template Skills Ingestion Inbox

> Status: operator inbox, documentation only  
> Runtime impact: none until `Layer S` is implemented

Use this folder as the drop zone for raw skill documents, manuals, excerpts, notes, and
research material that should be reorganized into template-specific skills.

Downloaded public references can temporarily go under `external-sources/<source-slug>/`, but this
folder is a working area only. Once consumed, remove the raw files and keep attribution in
`../EXTERNAL_SKILL_SELECTION_YYYY-MM-DD.md` and `../external-skill-routing.json`.

Agents should treat files placed here as unclassified source material. The expected workflow is:

1. Inspect every new file in this folder.
2. Extract reusable skill ideas into compact Markdown manuals under `../seed-catalog/`.
3. Assign each manual to one or more real preset folders under `../by-template/<preset-id>/`.
4. Update `../template-skill-map.json`.
5. Update `../README.md` when new manuals or new classification rules are introduced.

When the source is external, also update `../EXTERNAL_SKILL_SELECTION_YYYY-MM-DD.md` or the latest
external selection report, plus `../external-skill-routing.json` if the source changes template
coverage. Delete the raw external files after the distilled local manuals are created.

## Accepted Inputs

Preferred formats:

- `.md`
- `.txt`
- `.json`
- `.csv`
- `.html`

Avoid dropping secrets, private API keys, customer PII, credentials, proprietary code you do not
have the right to reuse, or full third-party copyrighted manuals that cannot be summarized.

## Classification Rules

Classify a source into a template folder only when it improves that template's generated artifact.

Use differentiated distribution:

- `landing`: conversion copy, hero sections, product positioning, CTA patterns.
- `website`: information architecture, navigation, content hierarchy, multipage structure.
- `form`: validation UX, field sequencing, onboarding/questionnaire patterns.
- `manifesto`: editorial rhetoric, typographic hierarchy, poster-like persuasion.
- `a4poster`: print layout, physical constraints, margins, hierarchy, export concerns.
- `infographic`: visual explanation, SVG, charts, diagrams, data storytelling.
- `data-dashboard`: metric grounding, chart semantics, comparison panels, dashboard states.
- `slideshow`: slide pacing, progressive disclosure, speaker-friendly structure.
- `keynote`: high-impact presentation craft, narrative, visual metaphors.
- `videogame`: 2D game loop, input, scoring, collision, feedback.
- `freerunner`: arcade physics, runner mechanics, obstacle pacing.
- `seriousgame`: learning objectives, assessment loops, educational feedback.
- `game3d`: 3D scene structure, camera, controls, performance constraints.
- `vr-aframe`: WebXR, VR scene semantics, comfort, interaction affordances.
- `interactive-story`: branching narrative, state, choices, consequence design.
- `neutral`: fallback only; do not add a skill unless it is genuinely universal.

## Duplicate vs Reference

Duplicating the same manual in multiple `by-template` folders is acceptable when the skill is
directly useful to each template and should be injectable without another lookup.

Prefer a shared seed manual with multiple mappings when:

- the same content applies unchanged to more than one template;
- the skill is foundational, such as SVG composition, game loops, or chart accessibility;
- future runtime wiring should load one canonical body by id.

Prefer a template-specific derivative when:

- the same source needs different constraints per template;
- a game skill differs materially between `videogame`, `freerunner`, and `seriousgame`;
- a visual skill has different output constraints for `infographic`, `a4poster`, and `keynote`.

## Suggested File Naming

For raw files dropped here:

```text
YYYY-MM-DD_source-topic.ext
```

Examples:

- `2026-07-08_phaser-platformer-notes.md`
- `2026-07-08_accessible-carousel-patterns.md`
- `2026-07-08_svg-viewbox-layout.txt`

For extracted seed manuals:

```text
<domain>-<capability>.md
```

Examples:

- `runner-obstacle-pacing.md`
- `dashboard-empty-error-states.md`
- `presentation-narrative-arc.md`

## Agent Output Contract

After processing ingestion files, report:

- which raw files were inspected;
- which seed manuals were created or updated;
- which template folders received each manual;
- whether any source was ignored, archived, or unsafe to use;
- whether `template-skill-map.json` stayed valid.

## Cleanup Rule

This inbox should normally contain only this `README.md`.

If other files remain here, they must be in one of these states:

- `pending`: not inspected yet;
- `consumed`: distilled into `seed-catalog/` and ready to delete;
- `rejected`: unsafe, irrelevant, duplicate, or too broad; delete after recording the reason.

Do not keep large raw third-party files in this folder after they have been consumed.
