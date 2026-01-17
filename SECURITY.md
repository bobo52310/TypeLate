# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in TypeLate, please report it responsibly. **Do not open a public GitHub issue for security vulnerabilities.**

### How to Report

You can report security issues through either of the following channels:

1. **GitHub Security Advisories** (preferred): Go to the [Security Advisories](https://github.com/bobo52310/TypeLate/security/advisories/new) page and create a new advisory. This allows for private discussion and coordinated disclosure.

2. **Email**: Send a detailed report to the repository maintainer via the email address listed on their GitHub profile.

### What to Include

- A description of the vulnerability and its potential impact.
- Steps to reproduce the issue.
- The version(s) of TypeLate affected.
- Any suggested fixes or mitigations, if available.

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within 72 hours.
- **Assessment**: We will investigate and provide an initial assessment within 7 days.
- **Resolution**: We aim to release a fix for confirmed vulnerabilities within 30 days, depending on complexity.
- **Disclosure**: We will coordinate with you on public disclosure timing. We ask that you do not disclose the vulnerability publicly until a fix is available.

## Scope

This policy applies to the TypeLate desktop application and its source code. It covers:

- The Tauri/Rust backend (audio recording, clipboard access, hotkey handling, system integrations).
- The React frontend (data handling, API key storage, IPC communication).
- Build and release infrastructure (CI/CD pipelines, code signing, update mechanisms).

### Out of Scope

- Third-party services (Groq API, Sentry) -- report issues directly to those providers.
- Vulnerabilities that require physical access to the user's machine.
- Social engineering attacks.

## Security Considerations

TypeLate handles sensitive data including:

- **API keys**: Stored locally using `tauri-plugin-store` (not in SQLite). Never transmitted except to the configured API endpoint.
- **Audio recordings**: Recorded and processed locally. Sent only to the Groq API for transcription.
- **Transcription history**: Stored in a local SQLite database on the user's machine.

## Supported Versions

Security updates are provided for the latest release only. We recommend keeping TypeLate updated to the most recent version.
