# Contributing to Encore

Thanks for your interest in contributing to Encore! With it being a Filipino project, it inhibits the core Filipino value of **bayanihan**; we build it together, as a community, for the community. Whether you're fixing a typo, squashing a bug, or proposing a new feature, you're welcome here.

This document covers how to get set up, what we expect from contributions, and how the process works end to end.

## Before you start

- **Encore is offline-first.** Features shouldn't assume an internet connection unless they're explicitly online-only (e.g. API integrations for metadata prefill). If your change touches core playback, recording, or scoring, test it with the network disabled.
- **We target low-spec hardware.** Encore needs to run smoothly on modest machines (Celeron-class CPUs & 4GB RAM). If you're adding something performance-sensitive, please profile it on low-end hardware where possible, or flag in your PR that this hasn't been tested there yet.
- **No ads or tracking.** This is a strict policy. Encore's business model does not run on the software. Don't add telemetry, tracking, or third-party analytics without an explicit discussion first.

## Getting set up

1. Fork the repo and clone your fork locally.
2. Install dependencies (see the [README](README.md) for current toolchain requirements. This changes as the stack evolves, so the README is the source of truth over this document).
3. Create a branch off `main` for your change: `git checkout -b fix/short-description` or `feature/short-description`.
4. Make your changes, following the guidelines below.
5. Test locally, including on low-spec hardware if your change is performance-relevant.
6. Open a PR using the pull request template.

## Coding guidelines

- Match the existing code style in the file/module you're editing rather than introducing a new convention. We recommend using [Visual Studio Code](https://code.visualstudio.com) with the Prettier extension.
- Keep performance in mind. We all don't have the highest-spec computers, and regressions here affect real users on real hardware at real events.
- Comment non-obvious logic, especially around timing, sync, and hardware-specific workarounds. Be as concise as possible when writing comments.
- Avoid adding new dependencies unless necessary. If you do, explain why in your PR. We're cautious about dependency bloat given our low-spec targets.

## Contributing with AI

We do not prohibit the use of artificial intelligence for your PRs, with the exception of these:

- Media, including but not limited to illustrations, videos and music generated with atificial intelligence is prohibited and contributions that include them will immediately get rejected.
- Contributions that are not transparent in their AI usage may get rejected.

## Commit messages

Keep commits focused and messages descriptive. A commit should do one thing; a PR can bundle related commits, but avoid grab-bag PRs that touch unrelated parts of the codebase.

## Submitting a pull request

- Fill out the PR template completely.
- Link any related issues.
- Be ready for review feedback. We may request for changes to better fit Encore.
- Small, focused PRs get reviewed faster than large ones.
