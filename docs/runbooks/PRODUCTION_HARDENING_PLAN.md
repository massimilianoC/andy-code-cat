# Production Hardening Plan

## Goal

Reduce the risk of production regressions around long prompts, CORS/preflight failures, browser storage limits, and frontend/backend drift.

This plan is intentionally **non-invasive**:

- no architecture rewrite
- no authentication redesign
- no database migration required
- no change to tenant isolation rules

---

## Safe Improvement Opportunities

### 1. API edge hardening

**Opportunity:** make CORS behavior more explicit and more predictable in production.

**Non-invasive actions:**

- explicitly allow the expected methods
- explicitly allow `Authorization`, `Content-Type`, and `x-project-id`
- answer `OPTIONS` requests consistently
- allow requests without an `Origin` header for health checks and server-side probes

**Expected benefit:** fewer browser-only failures that appear as generic network errors.

---

### 2. Browser storage resilience

**Opportunity:** avoid UI degradation when local browser storage reaches quota limits.

**Non-invasive actions:**

- wrap storage reads/writes in safe helpers
- treat quota failures as non-fatal
- purge only cache-like keys before retrying
- never let preview thumbnail caching block the main workflow

**Expected benefit:** long sessions remain usable even when the browser storage budget is almost exhausted.

---

### 3. Long-prompt operational safety

**Opportunity:** reduce the chance that a successful LLM generation fails during persistence or follow-up UX steps.

**Non-invasive actions:**

- keep context trimming active
- avoid persisting unnecessary oversized transient artifacts
- surface friendlier recovery messaging when a post-generation step fails

**Expected benefit:** fewer false negatives where the generation succeeds but the user sees an error afterward.

---

### 4. Deploy consistency checks

**Opportunity:** catch frontend/backend route mismatches immediately after release.

**Non-invasive actions:**

- run a smoke test against auth, conversation, WYSIWYG, preview, and publish endpoints
- verify the app domain and API domain both resolve and return the expected status codes
- verify preflight behavior from the real app origin

**Expected benefit:** faster rollback decisions and fewer production surprises.

---

## Recommended Delivery Sequence

### Phase A — Immediate hardening

- tighten CORS behavior at the API edge
- harden browser storage helpers
- keep all behavior backward compatible

### Phase B — Operational safety

- add a small production smoke checklist
- document the deployment verification commands

### Phase C — Observability

- log route-level failure categories for:
  - `401` auth failures
  - `404` missing routes/resources
  - `400` validation failures on large requests
  - browser-side storage quota issues

---

## Nginx / Deploy Best Practices

These are recommended for the droplet or production reverse proxy setup.

### Reverse proxy rules

- proxy all `/v1/` traffic to the API service
- preserve `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`
- keep `OPTIONS` requests enabled and unmodified
- do not add conflicting CORS headers in both nginx and the API unless they are intentionally aligned

### Timeouts

Use conservative but realistic upstream timeouts for chat/stream endpoints:

- `proxy_read_timeout 120s` or higher for streaming endpoints
- `proxy_buffering off` for SSE/stream responses

### Release safety

- deploy frontend and API together when route contracts changed
- validate the correct public origin is present in `CORS_ORIGIN`
- after env changes, restart only the target service with `--no-deps`

### Verification checklist

After each deploy, verify:

1. app UI loads
2. login works
3. a project conversation opens
4. a long prompt completes
5. WYSIWYG session creation works
6. publish endpoint returns the expected result

---

## Suggested Success Criteria

The hardening work is successful when:

- cross-origin requests from the production app origin no longer fail on preflight
- quota-related local cache failures do not interrupt the main UX
- long prompt flows either complete cleanly or fail with a clear recoverable message
- deploy validation can be completed in a few minutes with repeatable checks
