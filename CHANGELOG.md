# Changelog

## 0.7.0 — 2026-11-12

A leaner instruction set: each rule lives in one place, and text that code already enforces is gone. Ported from the measured trim of Alhaitham, Easy One's fork of this plugin.

- `references/harness.md` covers only what the plugin adds on top of Orca's own guide (3,367 → about 2,000 words). It now ends with **Enforced by code**: everything the guard, `dispatch.mjs` and `stories.mjs --check` enforce, so prose about those rules can be deleted safely.
- The orchestrate skill drops the duplicated harness and delivery rules, fixes the stale `--worktree new-child` step, and adds lesson retirement: a lesson leaves `CLAUDE.md` once code prevents its failure.
- The **If Orca dispatched you** section in every role file is one paragraph.
- The stories skill names the splitting patterns in one line instead of a numbered lecture.
- The one-time proof that Orca workers load the plugin and their role moved from `harness.md` into the install skill, its only user.
- Folder trust is no longer described as always prompting: on macOS, new worktrees started without it. Added a note on the brief «paste again to expand» pause.
- README rewritten; this changelog added.

## 0.6.3 — 2026-11-12

- The guard asks before an inline script only when it both mentions git and starts a program. Replayed over past sessions, prompts fell from about 1 in 25 Bash commands to almost none.

## 0.6.2 — 2026-11-12

- The guard asks the human before running an inline script (`node -e`, `python -c`, a heredoc) that mentions git, because git calls inside a script escape the command checks.

## 0.6.1 — 2026-11-12

- The switch-plus-commit check compares git subcommands only: a commit message containing "switch" no longer blocks.
- A single `&` separates commands, so a git call after it is checked.
- Once `core.hooksPath` is set, unsetting it, pointing it elsewhere, removing or renaming the `core` section and `git config -e` are blocked.
- Read-only roles can run read-only git commands with global options, such as `git -C dir status`.

## 0.6.0 — 2026-11-11

- `scripts/dispatch.mjs` launches a supervised Orca worker in one command: terminal in the worker permission mode, role file, empty shells closed, stop on any prompt, brief dispatched.

## 0.5.x — 2026-11-02 to 2026-11-06

- A same-failure breaker stops a builder that repeats a failing command.
- Builder reports carry a `Risk:` line; stale context references fail `stories.mjs --check`.
- Builders test only the feature: one acceptance test per criterion plus its error case.
- Fixes from a code review and from running on macOS.

## 0.4.0 — 2026-10-30

- Per-terminal role files for Orca workers; one review and one fix round per story; partial test runs keep earlier results.

## Earlier

- 0.3.x: renamed from orquestador; push needs confirmation instead of being blocked; writer worktrees are removed once their story is done; the install asks for the plugin's scope.
