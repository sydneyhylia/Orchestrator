# Orchestrator

A Claude Code plugin for orchestrated product work.

- The main session is the **orchestrator**. It contacts the human only for irreversible actions, product calls, what machines cannot verify, and final acceptance. It decides the rest itself.
- **The harness decides how it delegates.** In [Orca](https://orca.dev) the roles run as supervised workers under one orchestration Run: each in its own named terminal, with blocking questions, decision gates and a settlement the orchestrator must account for. In plain Claude Code they run as Agent-tool subagents. `skills/orchestrate/references/harness.md` maps the method onto each.
- **Role agents** do the work. The plugin ships `builder` (the only role agent that writes code), `reviewer`, `researcher`, `copywriter` and `designer`. These are a starting set: each project gets every role its work needs, written into the project's `.claude/agents/` from a template. Each role is a contract: inputs, output file, tools, turn limit and when to stop.
- **User stories** drive product work. Each story has acceptance criteria with a verification marker. A validator computes the status of each story and generates the map.
- **A guard hook** blocks the dangerous actions: push from role agents, force push, `--no-verify`, `reset --hard`, commits on protected branches, broad `git add`, and edits to locked acceptance tests. It also holds each role to its contract: a Claude Code subagent is recognised by its `agent_type`, an Orca worker by the `.orchestrator/role.json` the orchestrator writes into that worker's own workspace.

The plugin is inert in projects without `.orchestrator.json`. In projects with it, a session-start hook tells the main session to load the `orchestrate` skill.

## Contents

| Path | What it is |
|---|---|
| `skills/orchestrate/` | The orchestrator's operating procedure, harness detection, git rules |
| `skills/stories/` | How to write, split and maintain stories; English templates |
| `skills/install/` | Adapts the plugin to one project; assets copied into the project |
| `agents/` | The role contracts |
| `hooks/` | The guard |

## Install the plugin

Open Claude Code in the project and run:

```
/plugin install orchestrator --marketplace sydneyhylia/Orchestrator
```

Claude Code confirms the marketplace, shows what the plugin adds, and asks where to install it:

- **user scope:** you, in every project on this machine;
- **project scope:** everyone who works in this repository;
- **local scope:** you, in this repository only.

This form needs Claude Code 2.1.275 or later. On older versions, run `/plugin marketplace add sydneyhylia/Orchestrator`, then `/plugin install orchestrator@orchestrator-local`. Both open the same scope choice.

From your shell, for scripts, name the scope. Without `--scope` the shell installs at user scope, in every project:

```
claude plugin marketplace add sydneyhylia/Orchestrator --scope local
claude plugin install orchestrator@orchestrator-local --scope local
```

`/orchestrator:install` asks again when it finds the plugin at user scope.

From a local clone of this folder:

```
claude plugin validate .
claude plugin marketplace add .
claude plugin install orchestrator@orchestrator-local --scope local
```

To try it without installing: `claude --plugin-dir <path to this folder>`.

Claude Code builds its plugin registry when the process starts. After installing, start a new session — restart the CLI, not just `/clear` — or the skills, the role agents and the guard will not be there.

## Set up a project

Open the project and run `/orchestrator:install`. The install runs only on that command. It measures the project and asks only what it cannot measure. Then it writes:

- `.orchestrator.json`: the measured plugs (commands, runner limit, seams, language, git rules);
- project roles in `.claude/agents/`, when the project needs them;
- the story folder in the project's language, with `stories.mjs`;
- a block in `CLAUDE.md`;
- `.orchestrator/`: the ledger and the locked-tests list.

### Projects installed as orquestador

Before 0.3.0 the plugin was called orquestador. The guard still reads `.orquestador.json` and `.orquestador/`, so nothing breaks. To migrate a project:

1. Rename `.orquestador.json` to `.orchestrator.json` and `.orquestador/` to `.orchestrator/` with `git mv`.
2. Replace `.orquestador` with `.orchestrator` in `.gitignore` and in the `CLAUDE.md` block.
3. Replace the plugin: `claude plugin uninstall orquestador@orquestador-local`, then install `orchestrator@orchestrator-local` as above. Restart the CLI.

## Languages

The plugin is written in English. Each project's files are written in that project's language only. The install step translates the headings, markers and templates into `stories.config.json` → `labels` and `<storiesDir>/templates/`.

## Requirements

- Claude Code with plugin support.
- Node.js 20 or later, on `PATH` (the guard and the validator use it).
- Git. The GitHub steps use the `gh` CLI.
- Optional: [Orca](https://orca.dev). Without it the roles run as Claude Code subagents.

## Authors

Sydney and Claude (Claude Code, Opus 5). MIT licensed; see `LICENSE`.
