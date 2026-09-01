# Pull Request

## Summary

Describe what changed and why.

## Contract & Acceptance

- Owning spec / rule IDs or heading:
- Observable acceptance:
- Non-goals or relevant failure cases (if material/critical):

## Scope & Risk

- Risk tier: `routine` / `material` / `critical`
- Blast radius and recovery/rollback:
- Human decision recorded (critical or materially ambiguous only): N/A

## Verification

List the commands or manual checks run and their outcomes. Mark a check `N/A` with a short reason
when it does not apply.

## Checklist

- [ ] Branch follows Gitflow policy (base: `develop`, unless this is a hotfix)
- [ ] If this is a `release/*` branch, the name matches `release/YYYY.MM.DD.N` and `RELEASE_VERSION`
- [ ] Commits follow Conventional Commits
- [ ] No secrets or sensitive data were committed
- [ ] Contracts or APIs were updated when required (`packages/contracts`)
- [ ] Documentation was updated when needed (`docs/INDEX.md`, runbooks, architecture)
- [ ] No second execution path or conflicting current documentation was introduced
- [ ] Verification is proportionate to the declared risk and covers observable acceptance
- [ ] Material/critical negative, security, sandbox, cost, or failure cases are covered where relevant

## Linked Issues

Closes #
