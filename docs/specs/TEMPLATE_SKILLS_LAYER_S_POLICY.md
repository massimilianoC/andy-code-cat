# Template Skills Layer S Policy

> Status: project policy for filesystem-first Layer S  
> Runtime impact: none until the resolver is implemented and enabled  
> Related: `docs/specs/TEMPLATE_SKILLS_INJECTION_PLAN.md`

Layer S is the template-skill layer. It injects curated Markdown manuals after Layer B
(`preset-format`) and before style/context layers. Its purpose is to improve artifact quality for a
specific output type without bloating universal rules.

## Ownership

Layer S is owned by the preset/template quality track.

Allowed content:

- format-specific craft guidance;
- interaction patterns;
- visual direction;
- UX quality checks;
- implementation idioms for approved frontend libraries;
- concise review gates for the selected template.

Forbidden content:

- secrets, credentials, API keys, tokens;
- tenant/user/project data;
- backend service credentials or database policies;
- global platform rules already owned by Layer A;
- JSON response schema or reasoning-budget rules already owned by Layer E/Budget;
- contradictory viewport/layout framing already owned by Layer B;
- raw third-party manuals copied wholesale into runtime prompts.

## Filesystem Source Of Truth

The first implementation must use:

```text
docs/skills/template-skills/seed-catalog/          # canonical injectable manuals
docs/skills/template-skills/template-skill-map.json # preset -> skill id validation/documentation map
docs/skills/template-skills/by-template/           # runtime filesystem source, one folder per preset id
docs/skills/template-skills/ingestion/             # raw inputs, never injected directly
```

Runtime reads Markdown bodies from `by-template/<presetId>/*.md`. The folder name is the unique
template identifier and must exactly match `ProjectPreset.id`. `template-skill-map.json` remains a
validation/documentation map and should be kept in sync, but it is not the primary runtime router in
the filesystem-first phase.

`seed-catalog/` remains the canonical library of reusable manuals. Copy a seed file into one or more
`by-template/<presetId>/` folders to make it injectable for those templates.

## Selection Policy

For each preset:

- inject 2-5 skills maximum;
- prefer one structural/craft skill plus one style skill plus one validation/review skill;
- avoid injecting multiple competing style directions unless the user explicitly asks for a hybrid;
- drop hidden presets from UI selection, but keep their skill mappings valid for internal testing;
- keep `neutral` minimal so it remains a safe fallback.

Current product stance:

- `landing` and `website` are intentionally style-forward and should receive the strongest visual,
  brand, and anti-generic skills.
- `form`, `data-dashboard`, and `infographic` should receive interface craft and clarity skills,
  but not excessive art direction that harms usability.
- game presets should prioritize interaction, game feel, playability, and smoke-test patterns.
- print/presentation presets should prioritize identity, hierarchy, and export/screenshot quality.

## Quality Bar

A Layer S change is acceptable only if it improves at least one of:

- first-screen distinctiveness;
- conversion clarity;
- product/interface usability;
- artifact completeness;
- interaction reliability;
- visual hierarchy;
- accessibility;
- prompt-preview explainability.

A Layer S change is not acceptable if it:

- makes prompts much longer without visible artifact improvement;
- creates repeated instructions already present in another layer;
- causes the model to over-style utility templates;
- reduces factual grounding from attached documents;
- makes JSON parse failures or truncation more likely.

## Validation Workflow

For every skill-map change:

1. Validate `template-skill-map.json` parses.
2. Verify every skill id resolves to a file in `seed-catalog/`.
3. Verify every mapped preset id exists in `ProjectPreset.ts`.
4. Verify every runtime folder name under `by-template/` matches a real `ProjectPreset.id`.
5. Verify every mapped skill is present as a Markdown file in `by-template/<preset-id>/`.
6. Run prompt-preview for at least one changed template.
7. Compare Layer S char count against `LLM_TEMPLATE_SKILLS_MAX_CHARS`.
8. Generate at least one artifact before/after for a representative prompt.
9. Record observed quality changes and regressions in the relevant roadmap or report.

## Impact Evaluation

Use a small rubric before promoting Layer S from experiment to default:

| Dimension | Question | Target |
| --- | --- | --- |
| Distinctiveness | Does the output stop looking like a generic AI template? | Clear improvement |
| Fit | Does the skill match the selected preset? | No contradictions |
| Completeness | Are interactions/content more finished? | Equal or better |
| Parse safety | Does JSON remain valid and within budget? | No regression |
| Layer hygiene | Is the rule family owned by Layer S and not duplicated elsewhere? | Clean |
| User control | Can an operator remove/edit the skill quickly? | Yes, file + map edit |

Recommended test prompts:

- `landing`: "Create a landing page for an AI photo studio for boutique hotels."
- `website`: "Create a modern website for a design engineering consultancy with services and case studies."
- `form`: "Create a multi-step onboarding form for a SaaS analytics product."
- `videogame`: "Create a one-button arcade game about avoiding falling satellites."
- `data-dashboard`: "Create a dashboard from this sales dataset with KPIs, filters and insights."

## Rollback

Filesystem rollback is intentionally simple:

1. Remove the skill id from `template-skill-map.json`.
2. Leave the manual in `seed-catalog/` if it may be useful later.
3. Remove the mirror file from `by-template/<preset-id>/` if it no longer applies.
4. Re-run JSON and mirror validation.

No database migration or seed rollback is required in the filesystem-first phase.
