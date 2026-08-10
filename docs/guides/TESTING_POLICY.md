# Testing Policy

> For *what* to test next and in what order, see `docs/guides/TEST_COVERAGE_ROADMAP.md`. This
> document is about *how* to write a test once you've picked a target.

This repository's test discipline is enforced by convention, not by a written rule — until
now. This document codifies the conventions already followed by the healthiest parts of the
`apps/api` test suite, states the one rule that was found being violated during the RTF/ODT/
legacy-`.doc` parser work (see `docs/specs/DOCUMENT_FORMAT_COVERAGE_EXTENSION_PLAN.md`), and
records the gaps that remain open.

## 1. Co-location and naming

- Tests live in a `__tests__/` directory next to the source file they cover, one test file per
  source file: `Foo.ts` → `__tests__/Foo.test.ts`.
- A file exercising a specific behavior across several source files (an integration-style
  check) is named after that behavior, not after any single source file — e.g.
  `mimeCoverage.parity.test.ts`, `promptTraceParity.test.ts`.
- Runner: [Vitest](https://vitest.dev), configured per-workspace in `apps/api/vitest.config.ts`.
  `apps/web` has no test runner wired up yet — see §5.

## 2. Real fixtures over mocks — mock only at system boundaries

**Rule:** a unit test proves a module works by exercising its real logic against real (or
realistically-shaped) input. Reach for a mock only when the thing on the other side of the call
is a system boundary this repository does not control in a test process — a database, an
external HTTP provider, disk/object storage, wall-clock time. Never mock a sibling module of
application code to avoid dealing with its real behavior.

This is not a style preference — it changes what a green test actually proves. A test that
mocks `DocxParser` to make `LegacyDocParser`'s zip-delegation path pass proves only that the
delegation *call happens*; it proves nothing about whether the delegated call would actually
succeed against a real document. A test that builds a genuine in-memory `.docx` (zip +
`[Content_Types].xml` + `word/document.xml`) and runs it through the real `mammoth` parser
proves the path actually works.

**Established good examples in this codebase:**

- `PptxParser.test.ts`, `OdtParser.test.ts` — build a real zip fixture in-memory with `adm-zip`
  and parse it with the real parser. No mock.
- `LegacyDocParser.test.ts` — builds a real minimal OOXML `.docx` to test the
  mislabelled-`.docx` delegation path against the real `mammoth` parser, not a stub.
- 12 files legitimately use `vi.mock`/`vi.spyOn` for what they are: Mongo repositories,
  external HTTP calls, object storage, image capture — real system boundaries a unit test
  process cannot cross. That usage is correct and should continue.

**Anti-pattern to avoid** (found and corrected during this initiative): mocking a peer
application module — `vi.mock("../DocxParser")` inside a test for `LegacyDocParser` — because
building a real fixture felt harder than mocking. If a real fixture is genuinely infeasible to
build (see §3), say so explicitly in the test file and fall back to a documented manual
verification step instead of a mock that quietly proves less than it appears to.

## 3. When a real fixture truly cannot be built

Some binary formats do not admit a small hand-built valid fixture the way zip-based formats
(`.docx`, `.pptx`, `.odt` — all zip + XML) do. Legacy binary `.doc` (OLE/CFB, Word 6/95/97)
encodes text through a FIB header and a piece table, not a plain stream — a hand-rolled minimal
OLE2 container is not valid input for `word-extractor` and a test asserting against one would
not represent a real file.

In that situation:

1. Do not fabricate a fixture that only superficially resembles the real format.
2. Do not silently drop coverage — state explicitly in the test file (a comment, not a TODO)
   what is and is not covered, and why.
3. Fall back to a documented manual-verification step (see the target spec's own "Manual
   verification" section) rather than a green-but-meaningless automated test.
4. Never build a fixture from another user's real uploaded data found in local dev storage
   (MinIO, uploaded assets, etc.) — that is someone else's content, not a build artifact, and
   using it either directly or as a byte-for-byte template is a data-hygiene violation
   regardless of whether it is committed to git.

## 4. Anti-drift tests for duplicated configuration

Several places in this codebase intentionally duplicate a mapping across multiple files because
each file serves a different layer (parser selection, enrichment-kind classification, upload
allowlist, frontend accept list). Duplication here is a deliberate architectural choice, not an
oversight — but it means a change to one map silently drifts from the others unless something
catches it.

**Rule:** whenever you add an entry to one of a known set of duplicated maps, add (or extend) a
parity test that asserts every map agrees, using `it.each` over the shared list of inputs. See
`mimeCoverage.parity.test.ts` for the reference implementation — it currently covers the parser
factory, the enrichment-kind detector, and the upload allowlist for every document mime type.

If you introduce a new duplicated-map area (not just document mime types), add a same-shaped
parity test rather than trusting manual synchronization.

## 5. Config-dependent modules in tests

Some modules (anything importing `apps/api/src/config.ts`, directly or transitively) call
`process.exit(1)` at import time if required env vars (`MONGODB_URI`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`) are absent — the normal state of a unit-test process. Do not work around
this by mocking `config.ts` or by dropping the assertion. Follow the pattern already established
in `promptTraceParity.test.ts` and `PublishExportMediaGuardrails.test.ts`:

```ts
process.env.MONGODB_URI ??= "mongodb://localhost:27017/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret";

async function loadModuleUnderTest() {
    return import("../../path/to/module");
}
```

The `??=` makes it safe if another test file in the same worker already set the value; the
dynamic `import()` (not a static `import` at the top of the file) is required so the env
assignments run *before* the module — and its `config.ts` dependency — is evaluated. A static
import is hoisted by the JS engine and would run first, defeating the stub.

## 6. CI enforcement

As of this document, every pull request into `develop` or `main` runs (see
`.github/workflows/ci.yml`):

- `gitflow:guard` and `release:version:validate`
- Typecheck: `apps/api` and `apps/web`, `tsc --noEmit`
- `apps/api` test suite (`vitest run`)

Before this, none of the above was enforced automatically — a red test suite or a broken
typecheck could reach `develop` if nobody ran the commands by hand. Treat this workflow as the
minimum bar, not the ceiling: extend it (build steps, coverage gates, `apps/web` tests once §7
lands) rather than routing around it.

## 7. Known gaps — not fixed by this document

- **`apps/web` has no test runner wired up.** `apps/web/package.json`'s `test` script is a
  placeholder (`"test pipeline will be added in phase 2"`). Every frontend change — including
  the accept-list and fallback-extension logic added to `VibeCoreEntry.tsx` in the document
  format coverage work — currently ships with zero automated test protection. This needs its
  own scoping (Vitest + Testing Library is the natural choice given `apps/api` already uses
  Vitest) and is out of scope for this policy document.
- **No coverage reporting or threshold** is configured in `apps/api/vitest.config.ts`. A
  regression in an untested code path is invisible until it fails in production. Worth adding
  `@vitest/coverage-v8` with a soft threshold once `apps/web` testing exists too, so the two
  workspaces are brought up together rather than gating one and not the other.
