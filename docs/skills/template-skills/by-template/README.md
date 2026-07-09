# Template Skill Folders

This folder is the runtime filesystem source for Layer S. Each child folder is identified by real
`ProjectPreset.id`.

The same manual can appear in more than one preset folder. This intentional duplication makes each
template folder self-contained and easy to inspect. Runtime serializes every `.md` file inside the
current preset folder, excluding `README.md`, into Layer S.

## Folder Rule

Each child folder name must match a real preset id from
`apps/api/src/domain/entities/ProjectPreset.ts`.

## Current Preset Folders

| Preset id | Runtime status | Local skill manuals |
| --- | --- | --- |
| `neutral` | active | none |
| `landing` | active | `landing-conversion-copy`, `premium-landing-art-direction`, `modern-impact-visual-direction`, `brand-led-identity-system`, `anti-ai-slop-ui-review` |
| `website` | active | `website-information-architecture`, `product-interface-craft`, `modern-impact-visual-direction`, `brand-led-identity-system`, `anti-ai-slop-ui-review` |
| `form` | active | `form-ux-validation`, `product-interface-craft`, `anti-ai-slop-ui-review` |
| `manifesto` | active | `manifesto-editorial-rhetoric`, `svg-illustration-craft`, `modern-impact-visual-direction`, `brand-led-identity-system`, `anti-ai-slop-ui-review` |
| `a4poster` | active | `print-layout-a4`, `svg-illustration-craft`, `modern-impact-visual-direction`, `brand-led-identity-system` |
| `infographic` | active | `dataviz-chartjs`, `svg-illustration-craft`, `creative-canvas-p5`, `product-interface-craft`, `brand-led-identity-system` |
| `data-dashboard` | hidden | `data-dashboard-grounded`, `dataviz-chartjs`, `product-interface-craft`, `anti-ai-slop-ui-review` |
| `slideshow` | active | `slide-deck-craft`, `modern-impact-visual-direction`, `anti-ai-slop-ui-review` |
| `keynote` | active | `slide-deck-craft`, `svg-illustration-craft`, `modern-impact-visual-direction`, `brand-led-identity-system`, `anti-ai-slop-ui-review` |
| `videogame` | active | `game-input-and-loop`, `arcade-physics-phaser`, `creative-canvas-p5` |
| `freerunner` | hidden | `game-input-and-loop`, `arcade-physics-phaser` |
| `seriousgame` | active | `game-input-and-loop`, `serious-game-learning-loop` |
| `game3d` | active | `game-input-and-loop`, `webgl-scene-three` |
| `vr-aframe` | active | `webxr-aframe`, `webgl-scene-three` |
| `interactive-story` | active | `interactive-story-branching`, `brand-led-identity-system`, `product-interface-craft` |

## Runtime Rule

The filesystem resolver is implemented in
`apps/api/src/application/llm/templateSkillsLayer.ts`. It reads this folder through
`resolveContext()`, so prompt-preview and real generation share the same Layer S content.
