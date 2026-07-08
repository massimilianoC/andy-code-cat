# svg-illustration-craft

Applies to: `presetIds: poster, manifesto, infographic`, `tags: svg, vector`

Use this skill when the artifact needs crisp vector illustration, diagrams, icons, posters,
infographics, or responsive embedded SVG.

## SVG Baseline

- Use `viewBox` on every root SVG so it scales predictably.
- Keep SVG coordinate systems simple and intentional.
- Use groups (`<g>`) to organize layers such as background, subject, labels, and highlights.
- Use CSS classes or variables for repeated colors instead of duplicating inline values everywhere.

## Visual Craft

- Prefer a few strong shapes over many tiny decorative fragments.
- Align shapes to a clear layout grid or central visual axis.
- Use contrast between foreground, background, and accent details.
- Use paths only when necessary; simple rect/circle/line/polygon elements are easier to maintain.

## Accessibility

- Add a `<title>` and `<desc>` for meaningful standalone SVGs.
- Mark purely decorative SVGs as hidden from assistive tech.
- Do not encode important text only as path outlines when normal HTML text can do the job.

## Animation

- Animate transforms and opacity before animating complex path data.
- Keep animation optional and non-blocking.
- Avoid rapid flashing and respect reduced-motion preferences.

## Avoid

- Fixed pixel-only SVG with no `viewBox`.
- Huge inline SVG that dominates token budget without improving the artifact.
- Random decorative blobs unrelated to the brief.
- Text converted into unreadable paths.

## Acceptance Checks

- SVG remains sharp at mobile and desktop sizes.
- The visual subject is recognizable without reading code.
- The artifact still works if animations are disabled.
- Meaningful SVG has a title/description or visible text equivalent.

Sources:

- MDN SVG overview: https://developer.mozilla.org/en-US/docs/Web/SVG
- MDN `viewBox`: https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/viewBox
