# form-ux-validation

Applies to: `presetIds: form`, `tags: wizard, contact, lead`

Use this skill when generating forms, lead capture flows, onboarding questionnaires, or
multi-step wizards.

## Goal

The artifact must feel like a guided data collection flow. It should work as a complete
prototype without backend submission.

## Required Structure

- Intro explaining purpose, expected time, and benefit.
- Stepper or progress bar.
- 2-4 logical steps with no more than 3-5 visible fields per step.
- Per-step validation before advancing.
- Review step with editable summary.
- Success state with next steps and fallback contact.

## Validation Rules

- Validate required fields at the step boundary.
- Put errors next to the related field and summarize only if useful.
- Preserve entered values when moving back and forward.
- Disable or clarify submit while invalid.

## Accessibility Rules

- Labels must be programmatically associated with controls.
- Error messages must be readable and specific.
- Keyboard navigation must work across steps.

## Avoid

- One long generic contact form.
- Hidden required fields.
- Validation only after final submit.
- Backend-only behavior that cannot run in the static artifact.

## Acceptance Checks

- User can complete the flow without page reload.
- Back/next preserves state.
- Invalid fields block progress with clear errors.
- Final success state appears after valid submission.
