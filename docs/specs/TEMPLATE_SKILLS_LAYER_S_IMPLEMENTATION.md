# Template Skills Layer S Implementation

> Status: implemented filesystem resolver  
> Runtime entrypoint: `resolveContext()` in `apps/api/src/presentation/http/routes/llmRoutes.ts`  
> Resolver: `apps/api/src/application/llm/templateSkillsLayer.ts`

Layer S is now implemented as a filesystem-first prompt layer.

It is not a mock layer. The same `resolveContext()` path is used by:

- `GET /v1/projects/:projectId/llm/prompt-preview`
- `POST /v1/projects/:projectId/llm/chat-preview`
- `POST /v1/projects/:projectId/llm/chat-preview/stream`

Therefore the previewed Layer S, the provider-sent system prompt, conversation `promptingTrace`,
preview snapshot metadata, and `prompt_execution_logs.renderedSystemPrompt` are derived from the
same composed prompt.

## Runtime Source

Layer S reads Markdown files from:

```text
docs/skills/template-skills/by-template/<presetId>/*.md
```

The folder name is the unique template identifier and must exactly match `ProjectPreset.id`.

Examples:

```text
by-template/landing/
by-template/website/
by-template/videogame/
by-template/data-dashboard/
```

To customize a template:

1. Create or edit a skill manual in `docs/skills/template-skills/seed-catalog/<skill-id>.md`.
2. Copy it into `docs/skills/template-skills/by-template/<presetId>/<skill-id>.md`.
3. Keep `template-skill-map.json` updated for validation/documentation.
4. Run prompt-preview for a project with that preset and verify Layer S.

## Environment Contract

```text
LLM_TEMPLATE_SKILLS_ENABLED=true
LLM_TEMPLATE_SKILLS_ROOT=docs/skills/template-skills
LLM_TEMPLATE_SKILLS_MAX_CHARS=12000
```

Relative `LLM_TEMPLATE_SKILLS_ROOT` paths resolve from the monorepo root, not from process cwd.

## Resolver Algorithm

For each prompt composition:

1. Read the current project `presetId`.
2. Validate it as a safe folder id (`[a-z0-9-]+`).
3. Resolve `by-template/<presetId>/`.
4. Load all `.md` files in deterministic filename order.
5. Exclude `README.md`.
6. Drop empty files.
7. Add complete files until `LLM_TEMPLATE_SKILLS_MAX_CHARS` would be exceeded.
8. Build a `## LAYER S — TEMPLATE SKILLS` block.
9. Pass the block to `composeSystemPromptWithLayers({ skillsLayer })`.
10. Mark the prompt-layer trace source as `filesystem-template-skills:<presetId>:<skillIds>`.

The resolver never reads `ingestion/` and never injects raw external files.

## Persistence And Traceability

Real generations persist the actual prompt as follows:

- `Message.metadata.promptingTrace.effectiveSystemPrompt`
- `Message.metadata.promptingTrace.messagesSentToLlm`
- `Message.metadata.promptingTrace.layers` when no focused-edit addendum is appended
- `PreviewSnapshot.metadata.promptingTrace.effectiveSystemPrompt`
- `prompt_execution_logs.renderedSystemPrompt`
- `prompt_execution_logs.renderedUserPrompt`

Focused edit mode appends focused-edit guidance to the system prompt after base composition. In that
case, the prompt sent to the provider and stored in `renderedSystemPrompt` includes the focused
addendum.

## Docker Packaging

The production API image copies:

```text
docs/skills/template-skills
```

into `/workspace/docs/skills/template-skills`, so the resolver works in deploy builds and not only
on the host filesystem.

## Validation

Minimum checks after a Layer S change:

```text
npm run build -w apps/api
npm run test -w apps/api -- templateSkillsLayer
```

Manual prompt-preview check:

```text
GET /v1/projects/:projectId/llm/prompt-preview
```

Expected:

- `layers[]` contains id `S`;
- Layer S has `chars > 0` for a preset with Markdown files;
- source begins with `filesystem-template-skills:<presetId>:`;
- `effectiveSystemPrompt` contains `## LAYER S — TEMPLATE SKILLS`;
- real chat generation stores the same prompt in `prompt_execution_logs.renderedSystemPrompt`.

