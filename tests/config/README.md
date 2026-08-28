# Authorized models for live tests

`authorized-test-models.json` is the allow-list for any test, script or agent that calls a **real**
LLM provider.

## The rule

**Live calls spend the account owner's money.** Only models listed in `allowed` may be called
without asking. Anything else — including a single probe "just to compare" — needs the owner's
explicit approval first, for that specific run.

This exists because on 2026-08-26 an agent ran comparison probes on `anthropic/claude-opus-5` and
`x-ai/grok-4.6` without asking. EUR 0.17 in a few seconds. Small in absolute terms; not the agent's
call to make.

## Choosing a model

1. **Do not use OpenRouter `:free` variants.** They do not work reliably, so "it was free" is not a
   defence for a flaky or misleading test result. They are excluded on purpose, not by oversight.
2. Take the cheapest allow-listed entry that exercises what you are testing.
3. Ceiling is `policy.maxPriceInputUsdPerM` (USD 1.50 per 1M input tokens), set by the account
   owner. Above that: ask.

Model *quality* is not a reason to reach for a model outside the list. If a test only passes on a
frontier model, the test is measuring the model, not the code.

## For local models (LM Studio)

`lmstudio` is allow-listed with `"*"`: there is no metered cost. Use only models LM Studio reports
as **loaded** — the catalog marks them `· caricato`. Picking an unloaded one forces a swap into
memory, which is slow and disrupts whatever the owner had loaded.

## Checking a run's cost

```bash
docker compose -f docker-compose.deploy.yml exec -T mongodb mongosh andy-code-cat --quiet --eval '
const since = new Date(Date.now() - 60*60*1000);
db.cost_transactions.find({createdAt:{$gte:since}}).toArray()
  .forEach(r => print(r.resourceSubtype + "  EUR " + (r.totalEur ?? 0).toFixed(4)));'
```

## Keeping it current

Model ids and prices come from the live catalog and drift. When an id 404s, re-read it from
`GET /v1/llm/providers` rather than guessing a replacement — and if the replacement costs more than
the ceiling, ask before using it.
