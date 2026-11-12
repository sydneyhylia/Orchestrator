# Harness

The harness decides **how** you delegate, not whether. Every judgement in the `orchestrate` skill stays the same; only the mechanism changes. The guard states the harness at session start, detected from the environment: Orca when `TERM_PROGRAM=Orca` or any `ORCA_*` variable is set, plain Claude Code otherwise. Trust that line, not the ledger.

## Two mechanisms

|  | Orca supervised worker | Claude Code subagent (Agent tool) |
|---|---|---|
| Where it runs | its own agent session, terminal and workspace | inside your turn |
| The human | sees a named terminal and the Run inbox | sees nothing; the output reaches only you |
| Survives your compaction | yes; `worker-read` reads it back | no; it dies with your turn |
| Blocking question | the worker's `ask` → your `reply` | `NEEDS_CONTEXT` → `SendMessage` to the agent id |
| Role rules in the guard | from the role file `dispatch.mjs` writes | from `agent_type` |
| Cost | a whole agent session | cheap |

**In Orca the worker is the default.** Use the Agent tool only for a short read-only lookup whose answer only you need. Everything that writes, runs long, or produces a verdict the human will read is a supervised worker. When the human asks to supervise or track the work, it is always a worker: a subagent leaves no trace in Orca.

**In plain Claude Code** the Agent tool is the only mechanism. Parallel writers get `isolation: worktree`. Separate sessions run only if the human starts them; coordinate through `.orchestrator/work/` and cross-session messages. A message lasts as long as its session; the branch and the files are the durable record.

## Orca: the guide is the authority

Run `orca skills get orchestration` before the first delegation and follow it. It matches the installed CLI; this file only adds what the plugin needs on top and never overrides it. Read a reference at its action gate: `orca skills get orchestration --reference references/<file>.md` (`coordinator-loop`, `placement-and-remote`, `messaging-and-gates`, `recovery-and-cleanup`, `worker-contract`). Use the same executable for the whole Run.

If the orchestration layer is not reachable, report the exact error, fall back to the Agent tool, and say in the close report that the work ran unsupervised.

## The loop: what the plugin adds

- **One Run per block of work,** not one per story. Start the whole independent wave before the first wait.
- **Process every message in a Delivery before `--ack`.** Validate each `worker_done` against the Task you expected and the evidence rule of §5 of the skill.
- **Answer every worker's `ask` before you write to the human,** unless the answer needs the human. An ask expires: a builder whose questions expired while the orchestrator talked to the human was lost.
- **A wake that brings only heartbeats costs one call.** Acknowledge and wait again. A heartbeat proves liveness, never progress.
- **Account for every settled worker at once:** `worker-release`, then `orca terminal close --terminal <handle>`, then delete its role file. `worker-retain` only when the human asks. A finished terminal does not take a second dispatch: a fix round gets a fresh builder in the same worktree.
- **Remove a writer's worktree** when its story is done with it, after the commit and the release: `orca worktree rm --worktree <selector> --json`, without `--force`. If it refuses, leave it and name it in the close report. Never remove `current` or a worktree you did not create.
- **Absence proves nothing.** An empty wait, an unchanged tail or a lost connection authorizes no stop, retry or release. Leave a wait only on positive proof of exit, then follow `recovery-and-cleanup`.
- **Read a worker that goes quiet** with `worker-read`. If it waits at a prompt (folder trust, MCP approval, the bypass warning, a tool permission), never answer it: that consent is the human's. Stop the worker, show the human the exact prompt, and run the role through the Agent tool meanwhile, recorded as unsupervised.
- **A failed `worker-start` is not a reason to relaunch.** Follow `recovery-and-cleanup`. After three failed attempts a Task circuit-breaks: report it to the human instead of routing around it with a new Run or Task.

### The statuses of §5, in Orca terms

| §5 status | Orca |
|---|---|
| `DONE` | `worker_done --outcome succeeded` |
| `DONE_WITH_CONCERNS` | `worker_done --outcome succeeded`, concerns in the body and the report |
| `BLOCKED` | an `escalation` before completion, or `worker_done --outcome failed` |
| `NEEDS_CONTEXT` | the worker's `ask`; you answer with `reply --id <message_id>` |

A gate records a decision **you** own that blocks one Task while the rest of the wave runs. §7 of the skill still decides whether the answer is yours or the human's. Never create a gate merely to answer an `ask`.

## Placement and launch

- **Writers** (`builder`, a writing `copywriter`, a project role with `readOnly: false`) work in the worktree of their story's branch, one worktree per writer. The branch rules of `references/git.md` apply inside it.
- **Read-only roles** (`reviewer`, `researcher`, `designer`, a reviewing `copywriter`) run on `current`: they judge what is there and write only their report.
- **A folder workspace** has no worktrees and no branches: `git.md` does not apply, and the verification commands are the only evidence. Say so in the close report.
- Pass a model only when the human named one.
- Role agents never dispatch workers.

**Launch every worker with the script,** from the project root:

```
node <this skill's directory>/scripts/dispatch.mjs --role <role> --scope <scope> --brief <brief.md> \
  --worktree <current | branch:<branch>> --run <run id> \
  [--mode <your mode>] [--read-only] [--close-shells] [--keep-open] [--terminal <handle>] [--dry-run]
```

It opens the terminal in the worker permission mode, writes the role file, closes the empty shells of a new worktree (`--close-shells`), stops on any prompt, and dispatches the brief from its file. It prints `{ title, handle, dispatchId, workspace, roleFile }`; write the dispatch id in the ledger.

- `.orchestrator.json` → `roles.<name>.readOnly` decides whether a role writes. The plugin's roles have defaults; an undeclared project role is refused. `--read-only` tightens a writing role for one dispatch.
- Pass `--mode` with your own session's mode when `orca.workerPermissionMode` is not set.
- When the script stops at a prompt, take it to the human, then rerun the same command with `--terminal <handle>`.

What can stop a new worker before its turn:
- **MCP approval.** When the project declares servers in `.mcp.json`, Claude asks to approve them in every new folder, so the first worker of each worktree stops there.
- **Folder trust.** Claude may ask to trust a new worktree; no permission mode skips the question. It is not consistent: workers asked on Windows, while on macOS (Orca, 2026-11-12) three new writer worktrees started without it.
- **The bypass warning.** A `bypassPermissions` worker stops there unless the Claude profile Orca launches with has `skipDangerousModePermissionPrompt: true`.
- **Not a prompt:** a terminal can show «paste again to expand» for a few seconds while the brief arrives. Wait for the turn to start.

Without the script (for example on a remote host), the manual sequence is `terminal create --command "claude --permission-mode <worker mode>"`, the role file, `terminal wait --for tui-idle`, then `worker-start --terminal <handle> --spec-file <brief>`, with the same worktree selector in both. Prefer `branch:` selectors to `path:`.

## The brief is the spec

A worker starts with the Orca preamble, the spec and the project's `CLAUDE.md`, nothing else. It never loads `agents/<role>.md`: that file defines a Claude Code subagent, not a session. So the spec is the §4 brief, self-contained, with absolute paths, and it carries the role contract:

- For a **project role**, name `.claude/agents/<role>.md` in `Read first:`. It is inside the workspace.
- For a **plugin role** (`builder`, `reviewer`, `researcher`, `copywriter`, `designer`), paste its Rules, its stop condition, its Output shape and its **If Orca dispatched you** paragraph into the spec, unparaphrased. Never cite the plugin by path: it lives outside the workspace.

A worker that was not told its contract will invent one.

A fix round's spec is the role contract, the findings with their report paths, the story path and the reviewed commit. Do not repeat the build brief: the branch already holds that work.

## Browser

Orca exposes its workspace browser tab through the CLI: `orca tab list`, `goto`, `snapshot`, `screenshot --json`, `click`, `fill`, `type`, `keypress`, `eval`, `exec --command console`. Check that `orca tab list` returns a tab before you promise a UI check. Plain Claude Code has no browser of its own: skip the UI check there.

What real runs taught:
- A click outside the viewport does not register. Scroll the element into view with `eval` first.
- The snapshot can lag behind the page. Screenshots are the evidence.
- Pick elements by the snapshot's ref, scoped to the content region. A text match picked the wrong combobox and hit the sidebar's user menu.
- After a code change, run `orca reload` before checking. Hot reload missed a new component.
- There is one tab: never give the UI check to two agents at once.

## The guard

The guard reads a subagent's role from `agent_type`. An Orca worker is a full session, where `agent_type` is empty, so the guard reads its role from `<workspace>/.orchestrator/roles/<handle>.json`, which `dispatch.mjs` writes:

```json
{ "role": "builder", "scope": "ACC-002", "readOnly": false, "base": "<commit the builder starts from>" }
```

- `base` holds a builder only to the locked files it committed itself. Move it when you commit in a writer's worktree, or a commit made outside the flow stops the writer with a false BLOCKED.
- Delete the file when you release the worker.
- Never place a writer in a workspace whose root has no `.orchestrator.json`: it is unguarded.

### Enforced by code

None of these needs a rule in any text. When a lesson's failure is on this list, delete the lesson.

- **`hooks/guard.mjs`** blocks:
  - commits, merges, rebases, pulls and cherry-picks on protected branches;
  - pushes from role agents;
  - force pushes, `--no-verify`, `HUSKY=0`, and overriding or changing `core.hooksPath`;
  - broad `git add` and `commit -a`;
  - a branch change and a commit in one command;
  - `reset --hard`, `clean -f`, and `checkout .` / `restore .`;
  - writes, moves or deletes on locked tests, the locked-tests list, the generated map and the guard's own record;
  - a builder editing stories;
  - read-only roles writing outside `.orchestrator/work/` or running git commands that write;
  - role agents loading the `orchestrate` skill, dispatching workers or merging pull requests;
  - `worker-start --agent`, a worker terminal in the wrong permission mode, and `orca worktree rm --force`;
  - the same failing command after `verify.maxSameFailure` runs.

  It asks the human before:
  - every push and pull-request merge when `git.allowPush` is `false`;
  - an inline script (`node -e`, `python -c`, a heredoc) that mentions git and starts a program.

  It runs `verify.onBuilderStop` when a builder stops, and refuses the stop while locked files differ from their commit.
- **`dispatch.mjs`** handles the role file, the worker permission mode, the empty shells and the stop on a prompt. It refuses a second worker with the same role and scope, a writer on `current`, and a read-only role in a worktree.
- **`stories.mjs --check`** fails on a stale map and on a context document that names a missing path or script.

## Avoid

- Experimental agent teams as the backbone: their plan approvals bypass the human, and teammates do not survive a resume.
- Two writers on the same files, in any harness.
- `dispatch --inject` (it leaves the process unsupervised), `terminal close` in place of `worker-release`, and `orchestration reset` during active coordination.
- Starting services (Docker, a database, a dev server) inside a worker's terminal: releasing the worker closes them. One release closed Docker Desktop and took the database down. Start shared services yourself.
- Editing files inside a builder's worktree while it works: its `Stop` check restores them. Edit stories in your own checkout, after the release.
- Opening a browser, Orca's included, unless the brief or the human allows it. The `ui` key in `.orchestrator.json` is the human's permission for the UI check, and only for it.
