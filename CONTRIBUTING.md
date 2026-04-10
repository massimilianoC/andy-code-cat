# Contributing to Andy Code Cat

Thank you for your interest in contributing! This document outlines the process for submitting bug reports, proposals, and pull requests.

---

## Before You Start

1. Read [AGENTS.md](AGENTS.md) — it defines the architecture contract, layer rules, and coding conventions that all contributions must respect.
2. Read [docs/agents/CODE_AGENT_INDEX.md](docs/agents/CODE_AGENT_INDEX.md) — navigation guide for the codebase.
3. Check [open issues](https://github.com/massimilianoC/andy-code-cat/issues) and [discussions](https://github.com/massimilianoC/andy-code-cat/discussions) before starting work on a new feature.

---

## Reporting Bugs

Open an issue using the **Bug Report** template. Include:

- Steps to reproduce
- Expected vs. actual behaviour
- Docker version, OS, Node.js version
- Relevant logs (`npm run local:logs:api`)

---

## Proposing Features

Open an issue using the **Feature Request** template or start a **Discussion**. Large features should be discussed before implementation. The project follows the specs in `docs/specs/` — if your feature aligns with a planned spec, reference it.

---

## Pull Request Process

### 1. Fork & branch

```bash
git checkout -b feat/my-feature   # or fix/issue-123
```

### 2. Follow the architecture rules (non-negotiable)

- **Layer boundaries**: `presentation → application → domain` / `infra → domain`. No shortcuts.
- **Double sandbox**: every mutable user operation must validate both JWT identity and `x-project-id` ownership.
- **No hardcoded secrets**: use environment variables only. See `.env.example`.
- **Validation**: all external input must be validated via `packages/contracts` Zod schemas.

### 3. Code style

- TypeScript throughout — explicit types, no `any`.
- Keep functions small and focused (single responsibility).
- Prefer meaningful names over abbreviations.
- Comments only where intent is non-obvious.
- No inline styles in UI components — Tailwind utilities only.
- Use `Input`, `Button`, `Label` from `components/ui/` — never raw HTML elements.

### 4. Tests

- Add or update tests for changed behaviour.
- Run `npm run test` before pushing.
- For E2E, see `playwright.config.ts`.

### 5. Submit

- Open a PR against `main`.
- Fill in the PR template.
- PRs with failing checks will not be merged.

---

## Development Setup

See the [Quick Start](README.md#quick-start) section in the README.

```bash
# start with hot-reload
npm run local:dev:up

# tail logs
npm run local:logs

# restart API only after env change
npm run local:restart:api
```

---

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add export pipeline for static HTML
fix: correct JWT expiry check in refresh handler
docs: update architecture diagram
chore: bump dependencies
```

---

## Code of Conduct

Be respectful, constructive, and inclusive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/).

---

## Questions?

Open a [Discussion](https://github.com/massimilianoC/andy-code-cat/discussions) or leave a comment on a relevant issue.
