# Orchestrator

A Claude Code plugin for orchestrated product work: one main session plans and decides, role agents build and review, user stories with verifiable acceptance criteria define "done", and a guard hook holds every agent to its contract.

## How it works

- **The main session is the orchestrator.** It owns the plan, the decisions and the merge, and it delegates by its own judgement. It contacts the human only for irreversible or outward-facing actions, product calls, what machines cannot verify, and final acceptance.
- **Role agents do the work.** The plugin ships `builder` (the only role that writes code), `reviewer`, `researcher`, `copywriter` and `designer`. They are a starting set: each project adds the roles its work needs, from a template, in its own `.claude/agents/`. Every role is a contract: inputs, tools, output file and when to stop.
- **User stories drive the work.** Each acceptance criterion carries a verification marker: a passing test, a dated manual check, or an honest "unverified". A validator computes each story's status from them and generates the product map.
- **Every story follows one flow.** Ready check, a branch and its own workspace, acceptance tests written first and locked once green, one independent review, at most one fix round, then acceptance by the human.
- **A guard hook enforces the rules that matter most.** It blocks commits on protected branches, force pushes, skipped hooks, destructive git commands, broad `git add`, and edits to locked acceptance tests. It also holds each role to its contract: read-only roles cannot write, builders cannot edit stories, role agents cannot push or merge. The full list is in `skills/orchestrate/references/harness.md`, **Enforced by code**.
- **The harness decides how work is delegated.** Under [Orca](https://orca.dev), roles run as supervised workers under one orchestration Run, each in its own named terminal and workspace, launched with one command (`scripts/dispatch.mjs`). In plain Claude Code they run as Agent-tool subagents.

The plugin is inert in projects without `.orchestrator.json`. In a project that has one, a session-start hook tells the main session to load the `orchestrate` skill.

## Contents

| Path | What it is |
|---|---|
| `skills/orchestrate/` | The orchestrator's operating procedure; references for the harness, git and roles; `scripts/dispatch.mjs` |
| `skills/stories/` | How to write, split and maintain stories; templates |
| `skills/install/` | Adapts the plugin to one project, and the assets it copies there |
| `agents/` | The shipped role contracts |
| `hooks/` | The guard |
| `CHANGELOG.md` | What changed in each version |

## Install the plugin

Open Claude Code in the project and run:

```
/plugin install orchestrator --marketplace sydneyhylia/Orchestrator
```

Claude Code shows what the plugin adds and asks where to install it:

- **user scope:** you, in every project on this machine;
- **project scope:** everyone who works in this repository, in every checkout of it;
- **local scope:** you, in this folder only.

**With Orca, choose project or user scope.** Orca puts each writer in its own worktree, which is another folder; under local scope a worker there would run without the plugin, so without the guard. Project scope lives in the committed `.claude/settings.json`, so every worktree has it.

This form needs Claude Code 2.1.275 or later. On older versions, run `/plugin marketplace add sydneyhylia/Orchestrator`, then `/plugin install orchestrator@orchestrator-local`.

From a shell, name the scope; without `--scope` the plugin installs at user scope. Run these from the project's folder:

```
claude plugin marketplace add sydneyhylia/Orchestrator
claude plugin install orchestrator@orchestrator-local --scope project
```

From a local clone:

```
claude plugin validate ./
claude plugin marketplace add ./
claude plugin install orchestrator@orchestrator-local --scope project
```

To try it without installing: `claude --plugin-dir <path to this folder>`.

Claude Code loads plugins when the process starts. After installing, restart the CLI (not just `/clear`), or the skills, the role agents and the guard will not be there.

## Set up a project

Open the project and run `/orchestrator:install`. It measures the project, asks only what it cannot measure, and writes:

- `.orchestrator.json`: the project's plugs: verification commands, what tests cannot prove, seams, language, git rules;
- project roles in `.claude/agents/`, when the project needs them;
- the story folder in the project's language, with the `stories.mjs` validator;
- a block in `CLAUDE.md`;
- `.orchestrator/`: the ledger and the locked-tests list.

The install ends by proving each piece works on this machine: the verification commands, the validator, the guard, and one real delegation through the harness.

### Projects installed as orquestador

Before 0.3.0 the plugin was called orquestador. The guard still reads `.orquestador.json` and `.orquestador/`. To migrate a project:

1. Rename `.orquestador.json` to `.orchestrator.json` and `.orquestador/` to `.orchestrator/` with `git mv`.
2. Replace `.orquestador` with `.orchestrator` in `.gitignore` and in the `CLAUDE.md` block.
3. Run `claude plugin uninstall orquestador@orquestador-local`, install `orchestrator@orchestrator-local` as above, and restart the CLI.

## Design principles

- **Code over prose.** A rule the guard or a script enforces is not repeated in the instructions; the instructions keep only what a model cannot infer.
- **One rule, one home.** Each rule lives in the file of whoever acts on it. Lessons enter only from real failures in the project, and leave once code prevents them.
- **Evidence, not claims.** "Done" means command output or a passing test. A review verdict without evidence is rejected.
- **The human decides what only a human can.** Product calls, irreversible actions and acceptance always reach the human; everything else proceeds and is logged.

## Languages

The plugin is written in English. Each project's files are written in that project's language: the install translates the story headings, markers and templates into `stories.config.json` → `labels` and `<storiesDir>/templates/`.

## Requirements

- Claude Code with plugin support.
- Node.js 20 or later on `PATH`. The guard and the validator use it.
- Git. The GitHub steps use the `gh` CLI.
- Optional: [Orca](https://orca.dev). Without it, roles run as Claude Code subagents.

## License

MIT; see `LICENSE`. Written by Sydney and Claude (Claude Code).
