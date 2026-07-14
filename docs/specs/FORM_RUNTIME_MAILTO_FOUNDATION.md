# Form Runtime mailto foundation

Status: implemented foundation; public BaaS delivery modes remain disabled.

This first delivery adds a versioned, declarative `service-manifest-v1` beside the existing
`html/css/js` artifact triple. The model can declare forms and HTML slots, but it cannot provide
recipients, endpoints, secrets, retention settings, or submit JavaScript.

## Current contract

- `packages/contracts/src/serviceManifest.ts` is the shared, strict contract.
- `PreviewSnapshot.serviceManifest` persists the immutable definition with its artifact version.
- `Project.serviceConfig.forms` holds owner-controlled mailto delivery configuration.
- `POST/GET /v1/projects/:projectId/services/forms` requires JWT authentication and the existing
  project sandbox header/ownership check.
- `FormRuntimeCompiler` is a pure application module shared by preview snapshots, publish and ZIP
  export. It replaces only `data-pf-form-id` slots and writes executable logic to `artifacts.js`.

## Deliberate limits

- Only `mailto` is enabled.
- No anonymous public API, SMTP relay, submission capture, Redis limiter, or form-value persistence
  exists in this wave.
- No fallback silently converts future relay/capture modes to mailto.
- Artifacts without a service manifest, and projects with forms disabled, remain byte-compatible
  with the prior runtime path.

## Future extension point

`Project.serviceConfig` and `service-manifest-v1` are intentionally separate. Future adapters can
add tenant-owned external delivery profiles and a hardened public service router without changing
the LLM contract or allowing generated code to call arbitrary endpoints.
