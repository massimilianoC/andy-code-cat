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

## Branching Model (Gitflow)

This project follows a simplified **Gitflow** model. Understanding it before you open a PR will save you a lot of back-and-forth.

### Permanent branches

| Branch | Purpose | Direct push |
|---|---|---|
| `main` | Stable, production-ready code | **Never** — PRs only |
| `develop` | Integration branch — all features merge here first | **Never** — PRs only |

### Temporary branches

Always branch off `develop` (unless it is a hotfix — see below):

| Prefix | When to use | Example |
|---|---|---|
| `feat/<short-name>` | New feature | `feat/llm-cost-tracker` |
| `fix/<issue-or-name>` | Bug fix | `fix/jwt-expiry-check` |
| `docs/<topic>` | Documentation only | `docs/openrouter-guide` |
| `chore/<topic>` | Tooling, deps, config | `chore/bump-dependencies` |
| `refactor/<scope>` | Code restructuring, no behaviour change | `refactor/session-use-case` |
| `hotfix/<name>` | Critical production bug — branches off `main`, merges into both `main` AND `develop` | `hotfix/broken-publish` |

### Flow at a glance

```
main  ←── hotfix/<name>  (base: main → merges back into main + develop)
  ↑
develop ←── feat/<name>
             fix/<name>
             docs/<name>
             chore/<name>
```

> **Golden rule:** never commit directly to `main` or `develop`. Every change enters through a Pull Request.

---

## Pull Request Process

### 1. Fork & clone

If you are an external contributor, always work on a **fork** — not on a clone of the main repository:

```bash
# 1. Fork on GitHub (click "Fork" on the repository page)
# 2. Clone YOUR fork
git clone https://github.com/<your-username>/andy-code-cat.git
cd andy-code-cat

# 3. Add the upstream remote so you can stay in sync
git remote add upstream https://github.com/massimilianoC/andy-code-cat.git

# 4. Create your branch off develop
git fetch upstream
git checkout -b feat/my-feature upstream/develop
```

> Core team members with write access work on the same repository but still follow the branch model above — no direct pushes to `main` or `develop`.

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

- Open a PR against **`develop`** (not `main` — `main` is only updated via release merges).
- Fill in the PR template.
- PRs with failing checks will not be merged.
- Request a review; at least one approval is required before merging.

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

## Keeping Your Fork in Sync

Before starting any new branch, sync your fork with upstream to avoid conflicts:

```bash
git fetch upstream
git checkout develop
git merge --ff-only upstream/develop   # fast-forward only — keeps history linear
git push origin develop

# now create your branch
git checkout -b feat/my-next-feature
```

If your branch has fallen behind `develop` during development, rebase it (do not merge):

```bash
git fetch upstream
git rebase upstream/develop
```

> Rebase keeps commit history clean and PRs easy to review. Only use `git merge` when instructed to in hotfix flows.

---

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body — explain WHY, not just WHAT]

[optional footer — e.g. Closes #42]
```

| Type | When to use |
|---|---|
| `feat` | New feature visible to users |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that is neither a feature nor a bug fix |
| `test` | Adding or fixing tests |
| `chore` | Tooling, deps, config changes |
| `perf` | Performance improvement |
| `ci` | CI/CD configuration |

**Rules:**

- **One logical change per commit** — avoid "WIP" mega-commits. If you have multiple concerns, split them.
- Keep the subject line under **72 characters**.
- Write in the **imperative mood**: "add export pipeline", not "added" or "adding".
- Reference issues in the footer: `Closes #42` or `Refs #17`.
- Do **not** rewrite history on shared branches (`develop`, `main`) — no `git push --force`.

**Examples:**

```
feat(api): add cost tracking per LLM session
fix(auth): correct JWT expiry check in refresh handler
docs: add OpenRouter integration guide
refactor(session): extract session creation into use-case
chore: bump next from 14.1 to 14.2
test(api): add integration test for project sandbox enforcement
```

---

## Code of Conduct

Be respectful, constructive, and inclusive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/).

---

## Questions?

Open a [Discussion](https://github.com/massimilianoC/andy-code-cat/discussions) or leave a comment on a relevant issue.
