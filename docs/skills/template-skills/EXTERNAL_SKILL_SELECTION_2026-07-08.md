# External Skill Selection - 2026-07-08

> Status: consumed external source material for Layer S extraction  
> Runtime impact: none  
> Raw local files retained: no

This document records the intentionally small external research pass used to enrich the local
template-skill catalog. The downloaded raw Markdown files were used as source material, distilled
into compact local manuals under `seed-catalog/`, and then removed from `ingestion/` to keep the
repository lean.

Runtime Layer S must inject only local `seed-catalog/` manuals selected by
`template-skill-map.json`. It must never inject raw files from external repositories.

## Source Repositories

| Source | GitHub API license | Use in this repo | Local distilled outputs |
| --- | --- | --- | --- |
| https://github.com/abagames/agentic-gamedev-skills | MIT | Game mechanics, game feel, visual feedback, browser game smoke testing | `game-input-and-loop`, `arcade-physics-phaser`, `serious-game-learning-loop`, `creative-canvas-p5` |
| https://github.com/rohitg00/awesome-claude-design | MIT | Design prompts and recipes for landing pages, decks, wireframe-to-hi-fi, anti-default aesthetics | `premium-landing-art-direction`, `modern-impact-visual-direction`, `anti-ai-slop-ui-review`, `slide-deck-craft` |
| https://github.com/Dammyjay93/interface-design | MIT | Interface craft review, anti-slop review, dashboard/product UI quality | `product-interface-craft`, `anti-ai-slop-ui-review`, `website-information-architecture`, `form-ux-validation` |
| https://github.com/Leonxlnx/taste-skill | MIT | Style-direction signals: minimalist, brutalist, soft/high-end, brand kit | `modern-impact-visual-direction`, `brand-led-identity-system`, `premium-landing-art-direction`, `anti-ai-slop-ui-review` |
| https://github.com/VoltAgent/awesome-agent-skills | MIT | Discovery only; too broad for direct prompt injection | none |
| https://github.com/topics/claude-design | n/a | Trend signal only | none |
| https://github.com/topics/ux-design | n/a | Trend signal only | none |

## Consumed Raw Inputs

The following categories were inspected and consumed. The raw downloaded files are intentionally
not retained:

- minimal game-rule design;
- one-button microgame design;
- game feel improvement;
- game visual hierarchy and feedback;
- browser game runtime smoke-test patterns;
- anti-generic visual direction;
- landing page recipe flow;
- pitch/deck recipe flow;
- wireframe-to-hi-fi workflow;
- product interface craft;
- strict visual review;
- AI-slop UI removal;
- minimalist, brutalist, premium, and brand-system style directions.

## Current Local Routing

For the active local mapping, use:

- `docs/skills/template-skills/template-skill-map.json`
- `docs/skills/template-skills/external-skill-routing.json`
- `docs/skills/template-skills/by-template/`

`landing` and `website` are intentionally style-forward:

- `landing`: `landing-conversion-copy`, `premium-landing-art-direction`,
  `modern-impact-visual-direction`, `brand-led-identity-system`,
  `anti-ai-slop-ui-review`
- `website`: `website-information-architecture`, `product-interface-craft`,
  `modern-impact-visual-direction`, `brand-led-identity-system`,
  `anti-ai-slop-ui-review`

## Extraction Recommendations

- Keep raw external files only while actively processing them.
- Distill external ideas into local manuals before mapping them to templates.
- Prefer a maximum of 3-5 injected skill bodies per template.
- For style skills, inject one dominant direction unless the user explicitly requests a hybrid.
- For game templates, pair one design skill with one reliability/validation skill.

