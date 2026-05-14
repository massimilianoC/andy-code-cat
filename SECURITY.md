# Security Policy

## Supported Versions

This project uses a date-based release versioning scheme (`YYYY.MM.DD.N`).
Only the latest stable release receives security updates.

| Version        | Supported          |
| -------------- | ------------------ |
| Latest release | :white_check_mark: |
| Older releases | :x:                |

> Check [RELEASE_VERSION](./RELEASE_VERSION) for the current stable version.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

To report a vulnerability, use one of the following channels:

- **GitHub Private Vulnerability Reporting** (preferred): use the
  [Security tab → Report a vulnerability](../../security/advisories/new)
  feature on this repository.
- **Email**: contact the maintainer directly at the address listed on the
  GitHub profile if private reporting is not available.

### What to include

Please provide as much detail as possible:

- A clear description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept (if available)
- The version(s) affected (see `RELEASE_VERSION`)
- Any suggested mitigations

### Response timeline

| Step                              | Expected timeframe |
| --------------------------------- | ------------------ |
| Acknowledgement of your report    | Within **3 days**  |
| Initial triage and severity score | Within **7 days**  |
| Status update (fix or decline)    | Within **14 days** |
| Public disclosure (if accepted)   | After a patch is released and coordinated with the reporter |

### What to expect

- If the vulnerability is **accepted**: we will work on a fix, coordinate a
  disclosure timeline with you, and credit you (unless you prefer anonymity).
- If the vulnerability is **declined**: we will explain why, and the report
  will remain confidential.

We follow responsible disclosure principles and ask reporters to do the same:
please allow reasonable time for a fix before any public disclosure.
