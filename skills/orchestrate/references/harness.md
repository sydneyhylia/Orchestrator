# Harness

Detect once per session. The harness decides **how** you delegate, not whether. Every judgement in the `orchestrate` skill stays the same; only the mechanism changes.

## Detect

| Signal | Harness |
|---|---|
| `TERM_PROGRAM=Orca`, or any `ORCA_*` variable | Orca |
| none of the above | Plain Claude Code |

Check with `env | grep -E '^(TERM_PROGRAM|ORCA_|CLAUDECODE)'` or `Get-ChildItem env: | Where-Object Name -match 'ORCA|TERM_PROGRAM|CLAUDECODE'`.

Write the verdict on the first line of `.orchestrator/state.md`, with the Run id when the harness is Orca. A session that does not know its harness delegates to the wrong mechanism silently.

## Two mechanisms

|  | Orca supervised worker | Claude Code subagent (Agent tool) |
|---|---|---|
| Where it runs | its own agent session, own terminal, own workspace | inside your turn |
| The human | sees a named terminal, a row in `orca worktree ps`, the Run inbox | sees nothing; the output reaches only you |
| Survives your compaction | yes; output stays readable with `worker-read` | no; it dies with your turn |
| Blocking question | `orchestration ask` → your `reply`; decision gates | `NEEDS_CONTEXT` → `SendMessage` to the agent id |
| Role rules in the guard | `agent_type` is empty — you must declare the role (see **The guard**) | `agent_type` carries the role |
| Cost | a whole agent session | cheap |

**In Orca the worker is the default.** Use the Agent tool only for a short read-only lookup whose answer only you need and that you would otherwise do yourself. Everything that writes, runs long, or produces a verdict the human will read is a supervised worker. Never substitute the Agent tool when the human asked to supervise, monitor or track the work: that request is for Orca provenance, and an in-process subagent leaves none.

**In plain Claude Code** the Agent tool is the only mechanism. Parallel writers get `isolation: worktree`. Separate sessions only if the human runs them; coordinate through files in `.orchestrator/work/` and cross-session messages (ListAgents/SendMessage). A message lasts only as long as the session; the branch and the files are the durable record.

## Orca: the guide is the authority

Run `orca skills get orchestration` before the first delegation and follow it. It is version-matched to the installed CLI; this file only maps orchestrator onto it and never overrides it. Use the same executable for the whole run, and read a reference at its action gate. On Windows, PowerShell splits a multi-line `--spec` at its quotes; write the spec to a file and pass it from Git Bash as `--spec "$(cat <file>)"`.

```
orca skills get orchestration --reference references/<file>.md
```

`coordinator-loop` (waves, model/effort, terminal reuse) · `placement-and-remote` (new workspace, SSH, remote) · `messaging-and-gates` (inbox replay, groups, gates) · `recovery-and-cleanup` (failure, retry, stop, release) · `worker-contract` (what your workers owe you) · `low-level-topology` · `legacy-contract-migration`.

`orca status --json` names your own Orca session. If the orchestration layer is not reachable, report the exact error, fall back to the Agent tool, and say in the close report that the work ran unsupervised.

## The loop

One Run per block of work, not one per story: the Run is your inbox and your namespace. It does not place or schedule anything.

```
orca orchestration run-create --objective "<the block of work>" --json     # or run-use --run <id>
orca orchestration worker-start --terminal <handle> --worktree <its worktree> --spec "<the brief, inline>" --task-title "builder-ACC-002" --json
orca orchestration worker-start --terminal <handle> --worktree current --spec "<the brief, inline>" --task-title "researcher-pagos" --json
orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json
```

1. **Start the whole independent wave before the first wait.** Launch each terminal first (**Placement → Launch**). `worker-start --spec` creates the Task and its attempt in one call. Use `task-create --deps` plus `worker-start --task <id>` only for real ordering, and prefer parallel waves to chains deeper than three or four steps.
2. **Process every message in a Delivery before `--ack`.** The batch replays until acknowledged and carries the whole FIFO queue whatever the type filter says. Reply to each question, validate each `worker_done` against the Task you expected and against the evidence rule of §5 of the skill, and decide each settled terminal's next owner.
   - **Answer every worker's `ask` before you write to the human.** An ask expires; a builder whose questions expired while the orchestrator talked to the human was lost.
   - **A wake that brings only heartbeats costs one call.** Workers send heartbeats at the cadence Orca sets, and each one can wake you. Acknowledge the batch and return to the typed wait. Do not read terminals, re-plan or report on a heartbeat: it proves liveness, never progress.
3. **Account for every settled worker, immediately, exactly once:** `worker-release` it, or `worker-retain` only when the human asked for it. Never `terminal close` a worker that is not released. `worker-release` leaves the tab open, so after it close the terminal you launched with `orca terminal close --terminal <handle>`, and delete its role file (**The guard**). A finished worker's terminal does not take a second Dispatch: it changes identity and the dispatch fails. The fix round gets a fresh builder in the same worktree. Do not end your turn while `worker-list --run <id> --terminal-state reclaimable --json` returns rows.
4. **Remove each writer's worktree when its story is done with it.** That is after the story's commit and after its builder's release. Run `orca worktree rm --worktree <selector> --json` without `--force`. Orca also deletes the branch only when it can prove the branch is merged; the story's branch stays until the human merges it. If the removal refuses (uncommitted changes, a failed hook), leave the worktree and name it in the close report. Never remove `current` or a worktree you did not create. The guard blocks `worktree rm --force`: it discards uncommitted work.
5. **An empty wait or a timeout is a checkpoint, not a failure.** Keep rolling waits until every expected Dispatch settles. After three consecutive empty waits, enumerate with `worker-list --run <id> --include-remote --json` and run each row's literal `projection.nextAction`; a `none` action means read `liveness.reason` and keep waiting.
6. **Absence proves nothing.** `unverifiable`, a null `agentWait`, an unchanged output tail and a lost connection are all absence, and absence authorizes no stop, abandon, retry or release. Leave a wait only on positive proof: `exited` liveness, the worker's own observation of exit, or a transcript whose last agent turn sent no `worker_done`. Then load `recovery-and-cleanup` and choose `worker-stop` or `worker-abandon` explicitly.
7. **Read each new worker once, and any worker that seems stuck.** Right after `worker-start`, and whenever a worker goes quiet, run `worker-read` on its terminal. If the agent waits at a prompt (a folder-trust question, the Bypass Permissions warning, a tool permission request), never answer it: that is the human's consent. `worker-stop` the worker, tell the human the exact prompt, and run that role through the Agent tool meanwhile. Record it as unsupervised.
8. **A non-zero `worker-start` is not a reason to relaunch.** Read the receipt's `failedStage` and `residualResources` and follow `recovery-and-cleanup`. After three failed attempts a Task circuit-breaks: report it to the human instead of routing around it with a new Run or Task.

### The statuses of §5, in Orca terms

| §5 status | Orca |
|---|---|
| `DONE` | `worker_done --outcome succeeded` |
| `DONE_WITH_CONCERNS` | `worker_done --outcome succeeded`, concerns in the body and the report |
| `BLOCKED` | an `escalation` before completion, or `worker_done --outcome failed` |
| `NEEDS_CONTEXT` | the worker's `ask`; you answer with `reply --id <message_id>` |

A gate is for a decision **you** own that blocks one Task while the rest of the wave runs: `gate-create --task <id> --question … --options …`, then `gate-resolve`. It is where you record an answer, not a licence to give one: §7 of the skill still decides whether the answer is yours or the human's. Never create a gate merely to answer a worker's `ask`.

## Placement

A fresh worker means a fresh terminal, not a new Git worktree.

- **Writers** never share your workspace: create one with `orca worktree create --name <role>-<scope> --setup run --json` (no `--agent`). One worktree per writer, and the branch rules of `references/git.md` apply inside it.
- **Read-only roles** (`reviewer`, `researcher`, `designer`, a reviewing `copywriter`) run on `--worktree current`: they judge what is already there and write only their report. They need no commit and no worktree, so they stay supervised workers even when a ruling keeps the writers in the main checkout.
- **Folder workspaces are first-class.** When the workspace is a folder, there is no worktree lineage and no branch: `git.md` does not apply, and the story's evidence is the verification commands alone. Say so in the close report.
- **Name the work:** the terminal's `--title` and the `--task-title` are both `<role>-<scope>`.
- Pass a model only when the human named one: put `--model <id>` in the `claude` command.

### Launch: the worker mode, not Orca's default

`worker-start --agent claude` launches Claude with Orca's default arguments for new agent tabs, which the project does not control. So launch the terminal yourself and dispatch into it. The worker mode is `orca.workerPermissionMode` in `.orchestrator.json` when set (for example `bypassPermissions`), otherwise the permission mode your own session runs in. The guard blocks `worker-start --agent` and a `claude` terminal in any other mode, and its message names the mode:

```
orca terminal create --worktree <current | the writer's worktree> --title "<role>-<scope>" --command "claude --permission-mode <worker mode>" --json
#   write <that workspace>/.orchestrator/roles/<handle>.json (The guard)
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
orca orchestration worker-start --terminal <handle> --worktree <same selector> --spec "<the brief>" --task-title "<role>-<scope>" --json
```

Use the selector of `terminal create` in `worker-start` too, `current` included.

`orca worktree create` opens a plain shell as the new worktree's first terminal. A writer's worktree then shows an empty tab beside the worker. After `terminal create`, list the worktree's terminals and close every one that is not the worker's handle:

```
orca terminal list --worktree <the writer's worktree> --json
orca terminal close --terminal <the empty shell's handle> --json
```

Do this only in a worktree you created. On `--worktree current` the other terminals are yours and the human's.

If the wait reports a `blockedReason`, read the terminal and take the prompt to the human (rule 7 of **The loop**). Three prompts can stop a worker. When the project declares MCP servers in `.mcp.json`, Claude asks to approve them for each new folder: the first worker of every worktree stopped there. Approving a server is the human's call; never answer it for them. `agent-trust-workspace` is Claude asking to trust the folder; no permission mode skips it. Do not count on a trusted parent folder: on one machine a folder inside a trusted parent still asked. The human trusts each folder workers run in, and the install checks it. The Bypass Permissions warning stops a `bypassPermissions` worker unless the Claude profile it launches with has `skipDangerousModePermissionPrompt: true`; on a machine without it, every bypass worker stopped there. Verified on 2026-10-22: `bypassPermissions` started without a prompt in a trusted folder and stopped at the trust question in an untrusted one; a worker in `auto` mode ran its turn and sent `worker_done`.
- Role agents do not dispatch workers; their contracts say so. Nested workers obey `nested_worker_depth_exceeded`, and a new Run does not reset depth.

## The brief is the spec

Orca requires a **self-contained** spec: the injected preamble is all the worker starts with, and a worker in another workspace cannot read your ignored files by relative path. So pass the §4 brief **inline** as `--spec`, and keep writing it to `.orchestrator/work/<scope>/brief.md` as the durable record.

| Orca spec field | §4 brief line |
|---|---|
| Target | `Target:` |
| Change | `Change:` (reviewers: `Judge:`) |
| Constraints | `Constraints:` and `Read first:` |
| Ownership | `You may edit:` plus the role name |
| Observable acceptance | `Done when:` — the exact command |

The spec also carries the absolute path of the brief file, the absolute path of the report, the role name for the first line of the report, and the escalation clause. The worker writes its report and names it in `worker_done --report-path`.

**The spec also carries the role contract itself.** An Orca worker is a plain agent session: it never loads `agents/<role>.md`, because that file defines a Claude Code subagent, not a session. Nothing but the spec and the project's own `CLAUDE.md` reaches it. So:

- For a **project role**, add its file to `Read first:` — `.claude/agents/<role>.md` is inside the workspace and the worker can read it.
- For a **plugin role** (`builder`, `reviewer`, `researcher`, `copywriter`, `designer`), paste its Rules, its stop-and-report condition, its Output shape and the `If Orca dispatched you` block into the spec. Do not paraphrase them, and do not cite the plugin by path: the plugin lives outside the workspace and the path is not portable.
- Either way the spec ends with the lifecycle clause: `ask` for a blocking question, `check --terminal <handle>` at each checkpoint and once before finishing, exactly one `worker_done` with both lifecycle IDs, an explicit `--outcome` and `--report-path`.

A worker that was not told its contract will invent one.

A fix round's spec is the role contract, the findings to fix, with their report paths, and the story path. Do not repeat the build brief: the branch already holds that work.

## Browser

Orca exposes its workspace browser tab through the `orca` CLI: `tab list`, `goto`, `snapshot`, `screenshot --json`, `click`, `fill`, `type`, `keypress`, `eval`, and `exec --command console`. Check that `orca tab list` returns a tab before you promise a UI check. Plain Claude Code exposes no browser of its own; skip the UI check there.

What a real run taught:
- A click on an element outside the viewport does not register. Scroll it into view with `eval` first.
- The snapshot can lag behind the page. Screenshots are the evidence.
- Pick elements by the snapshot's ref, not by a regex over its text. A regex picked the wrong combobox twice.
- Scope every query to the content region, with a container selector. A text match also hit the sidebar's user menu.
- After a code change, run `orca reload` before checking. Hot reload missed a new component, and the tab stayed stale.
- There is one tab. Never give the UI check to two agents at the same time.

## The guard

`hooks/guard.mjs` reads the role from the hook's `agent_type`, which exists only for Agent-tool subagents. **An Orca worker is a full Claude Code session: `agent_type` is empty there.** Without a declared role, the read-only roles stop being read-only and the builder stops being held to red-to-green — silently. The git rules and the locked acceptance tests still apply, because those do not depend on the role.

Orca gives every terminal its handle in `ORCA_TERMINAL_HANDLE`, and the guard inherits it. So, for every Orca worker, after `terminal create` and before `worker-start`:

1. Write `<the worker's workspace>/.orchestrator/roles/<handle>.json`, with the handle `terminal create` returned:

```json
{ "role": "builder", "scope": "ACC-002", "readOnly": false, "base": "<commit the builder starts from>" }
```

The guard applies the role rules to that terminal only — plus the builder's verification gate, on the worker's `Stop` instead of `SubagentStop`. A worker on `--worktree current` gets its rules too, and your own terminal keeps none, because its handle differs.

2. `readOnly` decides whether the worker may write. Set it for every role, project roles included: `true` for `reviewer`, `researcher`, `designer`, a `security-reviewer`, any role that only judges.
3. `base` is `git rev-parse HEAD` in the builder's worktree before dispatch. The guard then holds the builder only to the locked files it committed itself. Without `base`, a commit made outside the flow, or merged in, stops the builder with a false BLOCKED.
4. Delete the file when you release the worker.
5. A workspace whose root has no `.orchestrator.json` is unguarded. Do not place a writer there.

A `.orchestrator/role.json` from before 0.4.0 still works in a linked worktree. Replace it with the per-handle file.

## Prove it once per project

Before you rely on any of this, prove the chain exists, the guard included. On one project every worker ran without the guard for a whole day, and nobody noticed:

```
orca orchestration run-list --json                 # your Run is there
orca orchestration worker-list --run <id> --json   # your worker is there, titled <role>-<scope>
```

Then prove the guard inside a worker. Launch a throwaway `researcher` on `current` with its role file, and give it this spec: run `echo probe > guard-probe.txt`, report the output, send `worker_done`. Read its terminal with `worker-read`. The proof is the guard's `orchestrator: researcher is read-only` message. If `guard-probe.txt` appears instead, delete it: either the workers do not load the plugin (check the Claude profile Orca launches them with), or the role file did not match the handle. Release the worker and close its terminal.

Record the result as a ruling in `.orchestrator/state.md`. Only `run_legacy_local` and an empty worker list mean the orchestration layer has never been used in this project.

## Avoid

- Experimental agent teams as the backbone. Their plan approvals bypass the human, and teammates do not survive resume.
- Two writers on the same files, in any harness.
- `dispatch --inject` (it leaves the process unsupervised), `terminal close` in place of `worker-release`, and `orchestration reset` during active coordination.
- Claiming a worker is dead, or retrying it, from absence alone.
- Starting services (Docker, a database, a dev server) inside a worker's terminal. Releasing the worker closes its terminal and what runs in it: one release closed Docker Desktop and took the database down. Start shared services yourself, outside the workers.
- Editing files inside a builder's worktree while it works. Its `Stop` check restores them. Edit stories in your own checkout, after the release.
- Opening a browser — Orca's embedded browser included — unless the brief or the human allows it. The `ui` key in `.orchestrator.json` is the human's permission for the UI check, and only for it.
