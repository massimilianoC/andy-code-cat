# slide-deck-craft

Applies to: `viewportModel: slide_deck`, `presetIds: slide, keynote`

Use this skill when generating slideshows, pitch decks, lesson decks, keynote-style pages, or
presentation artifacts.

## Slide Model

- Treat each slide as one full-viewport section.
- Give every slide a unique purpose: title, context, evidence, process, example, comparison, conclusion, or CTA.
- Keep slide text short enough to read at presentation distance.
- Use clear visual hierarchy: one main heading, one core idea, optional supporting detail.

## Navigation

- Provide previous and next controls.
- Support keyboard navigation with ArrowLeft, ArrowRight, PageUp, PageDown, Home, and End where appropriate.
- Support touch/pointer navigation through visible controls.
- Show current slide position, for example `3 / 8`.

## Accessibility

- Use semantic structure for the deck and each slide.
- Announce or expose the active slide state.
- Do not auto-advance by default unless the user can pause and resume.
- Ensure focus does not disappear when changing slides.

## Motion

- Use restrained transitions that support comprehension.
- Avoid motion that hides content, makes text unreadable, or blocks manual navigation.
- Respect reduced-motion media queries when possible.

## Avoid

- A long scrolling landing page when the preset expects a slide deck.
- Invisible controls.
- Auto-rotating slides without pause.
- Slides that depend on hover only.
- Overloaded slides with paragraph-heavy copy.

## Acceptance Checks

- User can move forward and backward with buttons.
- User can move with keyboard.
- Current slide index is visible.
- The first slide explains the artifact in one glance.
- The final slide has a clear conclusion or action.

Sources:

- W3C WAI carousel tutorial: https://www.w3.org/WAI/tutorials/carousels/
- WAI APG carousel pattern: https://www.w3.org/WAI/ARIA/apg/patterns/carousel/
