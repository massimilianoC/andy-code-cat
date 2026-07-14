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

## Declarative platform form runtime

When the artifact needs a real contact or lead action, declare it instead of inventing an endpoint
or recipient. Emit one empty slot for each form:

```html
<div data-pf-form-id='contact'></div>
```

Also emit a top-level `serviceManifest` with `version: "service-manifest-v1"`. Each form needs
an ID matching its slot, a purpose key, 1–5 steps, and typed fields. Use only standard field types
(`text`, `email`, `tel`, `textarea`, `number`, `select`, `radio`, `checkbox`, `date`, `time`,
`url`, `hidden_context`). Keep fields minimal and separate `privacy-acknowledgement` from
`marketing-consent` for newsletter requests.

The platform owns recipient, delivery mode, validation behaviour, and user data. Never create a
custom endpoint, recipient email, credential, or submission handler. If no form capability is
configured, the artifact remains a complete static prototype.

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
