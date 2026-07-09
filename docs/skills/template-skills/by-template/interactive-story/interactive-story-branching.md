# interactive-story-branching

Applies to: `presetIds: interactive-story`, `tags: story, branching, narrative`

Use this skill when generating branching stories, narrative games, choose-your-path artifacts,
or interactive brand stories.

## Goal

The artifact must be a playable narrative with state and consequences, not a linear story with
decorative buttons.

## Required Structure

- Intro scene with world, protagonist, stakes, and tone.
- Short scene cards with 2-4 choices.
- At least one state variable such as trust, energy, resources, clues, reputation, or risk.
- Choices that change scene text, state, route, or ending.
- Checkpoints where the story direction changes.
- At least two endings or one ending with different evaluation.

## Narrative Rules

- Keep scenes concise.
- Choices should create tradeoffs.
- Show consequences clearly without breaking atmosphere.
- Maintain continuity of names, tone, and state.

## Interaction Rules

- Let the user move forward through choices.
- Provide restart or replay.
- Show current state when it helps decision-making.

## Avoid

- Choices that all lead to the same text.
- Long paragraphs that bury interactivity.
- Random endings unrelated to prior choices.
- No restart path.

## Acceptance Checks

- The second choice changes state or route.
- At least one later scene reflects earlier decisions.
- End state depends on user path.
- Restart works without page reload.
