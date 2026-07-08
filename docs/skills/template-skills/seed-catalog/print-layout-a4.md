# print-layout-a4

Applies to: `presetIds: a4poster`, `viewportModel: print`, `tags: a4, poster, pdf`

Use this skill when generating A4 one-pagers, flyers, posters, worksheets, handouts, or
print-ready HTML artifacts.

## Goal

The artifact must fit a printable A4 canvas with clear hierarchy and no overflow.

## Required Structure

- One explicit print canvas sized for A4 portrait or landscape.
- Safe margins for printing.
- Primary title visible first.
- Secondary information grouped by importance.
- Contact/QR/link area where relevant.
- Optional tear-off, schedule, checklist, or worksheet region when requested.

## Layout Rules

- Use a fixed print composition plus responsive preview wrapper.
- Keep text large enough for print.
- Avoid relying on hover or motion.
- Ensure important content is not clipped at page boundaries.

## CSS Rules

- Include `@page` sizing when the preset requires print/PDF.
- Use `box-sizing: border-box`.
- Use print media rules to remove browser-only chrome.

## Avoid

- Long scroll pages pretending to be print documents.
- Tiny type, dense paragraphs, or edge-to-edge critical text.
- Interactive-only content that disappears in print.

## Acceptance Checks

- The artifact fits one A4 page.
- Print preview does not clip content.
- The hierarchy is readable in grayscale.
- Contact/date/location/action details are easy to find.
