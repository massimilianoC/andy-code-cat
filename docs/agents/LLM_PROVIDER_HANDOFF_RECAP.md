# LLM Provider Handoff Recap

## Context

This recap documents the first implementation slice for LLM provider modularity.
Goal: start with SiliconFlow now, while keeping architecture ready for multi-provider + BYOK per user and per pipeline role.

## What Was Implemented

1. Added LLM catalog domain model (provider + models + pipeline roles).
2. Added dual catalog source strategy:
   - `env` (default, no Mongo seed required)
   - `mongo` (reads from `llm_providers` collection)
3. Added idempotent Mongo seed for provider/model catalog.
4. Added read-only API endpoint to inspect active providers/models.
5. Added user-level LLM preference scaffold (`defaultProvider`) for future BYOK and role overrides.
6. Updated docs and environment contracts for new settings.

## New/Updated API Behavior

### Read-only LLM discovery endpoint

- Method: `GET`
- Path: `/v1/llm/providers`
- Auth: requires bearer token (`authMiddleware`)
- Response shape includes:
  - `source`: `env` or `mongo`
  - `providers`: provider catalog list
  - `byokEnabled`: boolean
  - `activeProvider`: default provider from env
  - `hasProviderApiKeyConfigured`: boolean

### Chat preview endpoint (no full pipeline required)

- Method: `POST`
- Path: `/v1/llm/chat-preview`
- Auth: requires bearer token (`authMiddleware`)
- Purpose:
  - test chat UX input/output against configured provider/model
  - allow fallback simulated response when provider key is missing
  - expose metadata needed by conversation logs (provider/model/usage/duration)

Request body:

- `message`: string
- `pipelineRole`: role key (default `dialogue`)
- `temperature` (optional)
- `systemPrompt` (optional)

Response includes:

- `reply`
- `provider`
- `model`
- `finishReason`
- `usage` (`promptTokens`, `completionTokens`, `totalTokens`)
- `durationMs`
- `simulated` (true when fallback mode is used)

## Environment Variables Added

- `LLM_CATALOG_SOURCE=env|mongo`
- `LLM_DEFAULT_PROVIDER=siliconflow`
- `SILICONFLOW_BASE_URL=https://api.siliconflow.com/v1`
- `SILICONFLOW_API_KEY=`

## Seed Commands

- Existing user/project seed: `npm run seed`
- New LLM catalog seed: `npm run seed:llm`

`seed:llm` is idempotent and upserts one provider (`siliconflow`) with role-mapped models and fallbacks.

## Main Files Introduced

- `apps/api/src/domain/entities/LlmCatalog.ts`
- `apps/api/src/domain/repositories/LlmCatalogRepository.ts`
- `apps/api/src/application/llm/defaultSiliconFlowCatalog.ts`
- `apps/api/src/application/use-cases/GetLlmCatalog.ts`
- `apps/api/src/application/use-cases/SeedLlmCatalog.ts`
- `apps/api/src/infra/repositories/MongoLlmCatalogRepository.ts`
- `apps/api/src/presentation/http/routes/llmRoutes.ts`
- `apps/api/src/scripts/seed-llm.ts`

## Existing Files Updated (Relevant)

- `apps/api/src/config.ts`
- `apps/api/src/app.ts`
- `apps/api/src/domain/entities/User.ts`
- `apps/api/src/domain/repositories/UserRepository.ts`
- `apps/api/src/infra/repositories/MongoUserRepository.ts`
- `apps/api/src/application/use-cases/RegisterUser.ts`
- `apps/api/src/application/use-cases/LoginUser.ts`
- `apps/api/src/scripts/seed.ts`
- `.env.example`
- `.env.docker`
- `apps/api/package.json`
- `package.json`

## Current Design Decisions

1. Source of truth for active catalog is selectable at runtime (`env` vs `mongo`).
2. For MVP default path, catalog comes from code defaults (`env`) and does not require Mongo pre-seeding.
3. Mongo seed exists to support admin-managed catalog evolution later.
4. User record now carries `llmPreferences.defaultProvider` as the first BYOK-ready hook.

## Validation Notes

- `npm run seed:llm -w apps/api` executed successfully.
- There are known unrelated/pre-existing TypeScript issues in conversation/dashboard areas in some runs.
- New LLM files and touched LLM-related files were validated without diagnostics in the focused error check.

## Recommended Next Steps For Next Agent

1. Add authenticated endpoint to update user LLM preferences:
   - set `defaultProvider`
   - set role-based model overrides (`roleModelOverrides`)
2. Introduce secure BYOK key storage strategy (encrypted at rest, never plaintext in logs/responses).
3. Add provider adapter interface (`LLMProvider`) and first runtime adapter for SiliconFlow chat/vision.
4. Bind pipeline execution roles to user/project preferences with deterministic fallback rules.
5. Add integration tests:
   - `/v1/llm/providers` for both `env` and `mongo` modes
   - `seed:llm` idempotency
   - login/register response contract with `llmPreferences`
6. Add integration tests for `POST /v1/llm/chat-preview`:
   - live provider path (API key configured)
   - simulated fallback path (API key missing)
   - conversation persistence of assistant/error messages and background task logs

## Operational Quick Start

1. Keep `.env` with `LLM_CATALOG_SOURCE=env` for no-seed startup.
2. Switch to `LLM_CATALOG_SOURCE=mongo` when catalog should come from DB.
3. Run `npm run seed:llm` after switching to mongo source.
4. Use `GET /v1/llm/providers` to verify effective catalog source and active models.
