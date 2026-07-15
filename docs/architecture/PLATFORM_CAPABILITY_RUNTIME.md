# Platform Capability Runtime

Status: the `mailto` form slice is implemented on `feat/declarative-form-runtime`; public relay,
capture and other BaaS capabilities remain deferred.

## Boundary

The LLM declares capability intent only. It emits an empty slot and a strict
`service-manifest-v1`. Owner settings provide trusted delivery configuration. The application
registry resolves those inputs into a public `runtime-plan-v1` and allowlisted browser assets.

`prepareArtifactServices()` is the common preparation boundary for preview, capture, publish and
ZIP. Canonical snapshots keep the original slot, manifest and generated artifacts; they never
store a compiled recipient-specific runtime.

## Runtime assets

The mailto slice resolves these files in dependency order:

```text
pf-runtime-core.v1.js
pf-runtime-config.v1.js
pf-forms-ui.v1.js
pf-forms-mailto.v1.js
```

Each `runtimePlan` asset carries a SHA-256 content hash and dependency list. Publish and ZIP write
the assets as separate files with hash-versioned references. Preview/capture inject the same
assets as separate script elements before the generated artifact script. Platform runtime code is
never concatenated into `artifacts.js` or published `script.js`; a syntax error in generated code
therefore cannot prevent the already-loaded form runtime from mounting.

Snapshots produced by the original mailto compiler may contain its platform runtime as a complete
suffix of `artifacts.js`. The preparation boundary removes only that known legacy suffix, requiring
the historical header, multiple body fingerprints and the end-of-file closure. It does not scan
for or rewrite generic project JavaScript.

## Generated JavaScript gate

`assertGeneratedJavaScriptSyntax()` parses `artifacts.js` without executing it. Invalid generated
JavaScript returns an actionable `422 INVALID_GENERATED_JAVASCRIPT` diagnostic before snapshot
activation, publish or ZIP export. Inactive preview remains possible so the platform-owned runtime
can render and expose the failure without silently publishing broken code.

## Mailto privacy and UX

`mailto` is a local adapter, not a public BaaS operation. It does not send or persist submitted
values through the Andy Code Cat API. Platform events contain only version, form ID, mode, status,
URI length and fallback outcome; they never expose submitted values, the recipient or a complete
`mailto:` URI.

The adapter uses separate RFC-safe header/body encoding. Long URIs try local clipboard copy and
fall back to an explicit manual-copy textarea when clipboard access is unavailable. UI copy says
that opening a draft was requested and always asks the visitor to verify their email application;
it never claims delivery.

## Prompt contract

Layer V is the sole owner of the slot and service-manifest protocol. It explicitly prohibits LLM
submit handlers, endpoint or recipient generation, runtime copies, and placing the manifest inside
HTML, CSS or JavaScript. Layer S may guide form craft without redefining the operational protocol.

Layer V remains registered in `PROMPT_LAYER_DESCRIPTORS` and appears in every prompt trace,
including as an empty row. Focused edit instructions and focused governance are registered as
Layer Q before provider send. `assertPromptTraceParity()` fails closed unless the provider system
message, `effectiveSystemPrompt`, descriptor order, empty rows and marker spans are byte-exact.
The frontend renders persisted `layers[]` only; old traces without structured layers remain raw.
