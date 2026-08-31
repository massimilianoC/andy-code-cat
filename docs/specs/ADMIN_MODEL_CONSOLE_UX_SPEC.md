# Admin Model Console — UX Requests

**Status: recorded, not implemented.** Written down at the owner's request so the ideas are
not lost, explicitly deferred until after the current release candidate ships. Nothing here
has been built.

---

## Why this document exists

The model console (`/admin/models`) works, but the owner's report of it — "activation did not
seem effective, the flags only worked on the first provider, it felt unresponsive" — turned
out to have **two causes, both already fixed in code**, plus a set of genuine UX gaps that
are not fixed and are recorded below.

Separating the two matters, because the UX changes would have hidden the defects rather than
fixed them.

### What was actually broken (fixed, not part of this spec)

1. **Discovery was erasing activations.** `markAvailability()` forced `isActive: false` on any
   stored model missing from a live discovery response. SiliconFlow's discovery is unstable —
   13 models reported on one startup, 77 on the next — so activations made through the console
   were wiped on the next restart. OpenRouter's discovery is stable, which is exactly why its
   flags appeared to "stick" while SiliconFlow's did not. That asymmetry is the likely source
   of "the flags only work on the first provider".
2. **A deprecated model could not be switched on at all.** The request was skipped and reported
   as `deprecated` in the response, which the page surfaced as a terse "N model(s) skipped".
   From the operator's side that is indistinguishable from a toggle that does nothing.

Both are closed. `isActive` now means one thing — the operator wants this model usable — and
`availability` is advisory.

---

## Requests, as stated

1. **Active models should read as active at a glance.** Blue icons for active entries, rather
   than requiring the operator to read a chip.
2. **Filter the list by state**: active only, inactive only, or all. Filtering over the
   collection, not over the currently rendered page.
3. **Provider switching must be responsive, and flags must work on every provider**, not only
   the one that happens to be selected first.
4. **A combo box that filters intelligently**, with multi-level filters over the collection —
   provider, author, state — instead of a single flat list.

Explicit constraint from the owner, quoted because it governs the whole design:

> "ma non strafare, usa componenti esistenti"

So: no new design system, no new filter framework, no new state library. Whatever is built
reuses `components/ui/` and the grouping the page already does.

---

## What already exists and must be reused

| Asset | Where | Note |
|---|---|---|
| Author grouping | `apps/web/app/admin/models/page.tsx` | already groups a provider's models by author, with group-level activate/deactivate |
| Provider selector | same file, `selectedProvider` state | switching works; the perceived failure was the erased activations |
| `ProviderModelPicker` | `apps/web/components/llm/ProviderModelPicker.tsx` | already has provider scoping, a text query, an `includeInactive` flag and an "OFF" chip |
| Batch activation | `SetLlmModelsActive` + `POST` admin route | one decision, one request — already the batch shape the owner asked for |
| `isActive` / `availability` | `llm_providers` documents | the two fields the filters would read |

`ProviderModelPicker` already implements most of request 4 — provider scope, query filter,
inactive handling, state chips. The likely correct move is to reuse it in the console rather
than build a second filtering surface, which would be the "two parallel lines" problem again.

---

## Open questions — for the owner, not for an agent to decide

1. **Does the filter belong in the console only, or in `ProviderModelPicker` too?** The picker
   is used in Vibe and in the workspace; a state filter there would change what end users see,
   which is a product decision, not a UI one.
2. **What should "blue" mean exactly** — active, or active *and* currently offered? A model
   that is active but no longer served by the provider is now a legal state, and it is the one
   an operator most needs to notice.
3. **Is a per-provider view still right at 500+ models?** The catalog currently holds 426
   OpenRouter, 87 SiliconFlow and 7 LM Studio entries. A single searchable list across
   providers may serve better than a provider switch, but that is a bigger change than the
   constraint above allows.

---

## Related

- `AGENTS.md` — "Language", and Rule Zero's corollary on sources of truth
- `docs/specs/GENERATION_PROGRESS_INSPECTOR_PLAN.md` — the other deferred UX piece
