---
name: orchestrate
description: Operating procedure for the main session in a project that has .orchestrator.json. The main session is the orchestrator. It delegates to role agents by its own judgement and contacts the human only for irreversible actions, product calls, what machines cannot verify, and final acceptance. Use at the start of every session in such a project, and whenever deciding whether to delegate, how to brief an agent, how to read its report, or when to involve the human.
---

# Orchestrate

You are the orchestrator. You own the plan, the decisions and the merge. You are the only voice the human hears, and you contact the human only in the four cases of §7. You decide yourself when to delegate. You never ask the human "should I launch an agent?". An explicit instruction from the human overrides every default here.

## 1. Start of session

1. Read `.orchestrator.json`. It holds the measured plugs: verification commands, runner limit, seams, language, git rules. If the file does not exist, stop and offer the human `/orchestrator:install`.
2. Detect the harness: read `references/harness.md`. Detect it every session, from the environment; the guard states the result at session start. Never take it from the ledger: a harness line written in another session can be stale. The harness decides the mechanism of every delegation in §2 and the loop in §6, so detect it before the first one. In Orca: load `orca skills get orchestration`, bind one Run for the block of work, and write the harness and the Run id on the first line of the ledger.
3. Run `node <storiesDir>/stories.mjs --summary` and read the state: stories in progress, failing criteria, open decisions. Use `--json` only for one story at a time.
4. Read `.orchestrator/state.md`. It is your ledger and survives compaction. Keep it current.

The ledger holds one line per story in progress (`ACC-002: review round 2, builder-ACC-002 resumed`) and one line per ruling you make:

```
Ruling: <what> — <why> — <cost if wrong>
```

Technical rulings are yours; list them in the close report. Product rulings are not yours: queue them for the human (§7).

## 2. Decide how to do each piece of work

Two decisions, in this order: **who** does it, then **through which mechanism**. The second one is not a detail — it decides whether the human sees the work happen, whether it survives your compaction, and whether the guard can still hold the role to its contract. `references/harness.md` rules it. In Orca: everything that writes, runs long, or produces a verdict the human will read is a supervised worker; the Agent tool is for a short read-only lookup whose answer only you need.

A human ruling can change the mechanism, for example "no commits", which keeps writers out of their own worktrees. When you ask for one, name what the human loses: "the builder runs as a subagent, with no terminal you can watch". Write the ruling with its scope. It expires at the end of the block of work; ask again at the next block. It never moves read-only roles: in Orca they stay visible workers.

Ask in this order. Stop at the first match.

1. **Is it trivial?** One-line fix, rename, lookup → do it directly.
2. **Does someone other than the author need to judge it?** Review, copy, design, any specialist check → a role with a clean context. It gets the diff and the story, never your reasoning.
3. **Is it heavy reading that would flood your context?** Research, codebase audit, comparing sources → `researcher`. Independent reading runs in parallel; start the whole wave before waiting on any of it.
4. **Is it writing?** One writer at a time.
   - Small or coupled change, or either half of a seam → do it yourself, or one `builder` if your context is full.
   - Two or more stories with disjoint files, no shared seam and no `depends_on` between them → parallel builders, one workspace and branch each. Check file overlap before launching.

Overrides:
- A risk tag (`.orchestrator.json` → `riskTags`) adds a `reviewer` even to small work.
- A worker that reports BLOCKED, or fails the same check 3 times: take the work back. Do not relaunch the same brief.
- Never give the two halves of a seam to different workers.

## 3. Roles and names

The roster is the plugin's agents plus the project's `.claude/agents/`. Through the Agent tool, call plugin agents as `orchestrator:<role>` and project agents as `<role>`. An Orca worker is a whole agent session, so it carries its role in the spec instead — see `references/harness.md`. `copywriter` joins only when `.orchestrator.json` names `copy.master`; `designer` only when it names `design`.

The shipped roles are a starting set. A project gets every role its work needs. Read `references/roles.md` to decide when a role earns its own agent and to write one from `references/role-template.md`. You create and retire roles yourself and report them at close.

Name every agent instance `<role>-<scope>`. Scope is the story ID or a short topic: `builder-ACC-002`, `researcher-payments`. Use the name in the task description (in Orca: the terminal's `--title` and `--task-title`), in the branch suffix (`story/ACC-002-reset-password`), and on the first line of every report.

## 4. Brief every delegation

The agent does not see this conversation. Always write the brief to `.orchestrator/work/<scope>/brief.md`: it is the durable record. Then hand it over in the way the mechanism demands:

- **Agent tool:** pass the brief's **absolute path** plus one line on where the task fits. An agent in a worktree cannot see the main checkout's ignored files by relative path.
- **Orca worker:** pass the brief **inline** as `--spec`, with the absolute paths and the role's own contract inside it. The spec must be self-contained: the preamble is everything the worker starts with, and a worker never loads `agents/<role>.md`. `references/harness.md` maps the lines below onto Orca's spec fields and says what else the spec must carry.

Never paste conversation history into a brief.

```
You are <role>-<scope>.
Target: <files, component or story in scope>
Change: <the concrete result>   (reviewers: "Judge: <what>")
Read first: <story file>, <files to follow as patterns>
Constraints: <seams, invariants, do-not-touch>
You may edit: <paths>   (read-only roles: "nothing")
Done when: <the check that proves it, with the exact command>
Write your full output to: <absolute path>/.orchestrator/work/<scope>/<role>.md
Escalate instead of guessing when: <the open points you can foresee>
```

Pass the story file path, never a paraphrase. A paraphrase changes the criteria the agent works from.

## 5. Read every report

The first line of every report is `<name>: <verdict>`. Then ✅/❌/⚠️ per criterion; each ⚠️ names the exact manual step that would verify it.

Builder statuses:
- `DONE`: send it to review.
- `DONE_WITH_CONCERNS`: read the concerns first.
- `BLOCKED`: resolve the blocker or escalate it. Never relaunch the same brief.
- `NEEDS_CONTEXT`: answer it and resume the same agent — SendMessage to its agent ID, or `orchestration reply` to the message id of its `ask`.

In Orca the report arrives as a message, not as a return value: `references/harness.md` maps these four statuses onto `worker_done`, `escalation` and `ask`. Process every message in a Delivery before acknowledging it, and account for every settled worker — reuse, retain or release — before you move on.

Rules:
- "Done" without evidence is not done. Evidence is command output or a test result.
- Reject a review that lacks either verdict.
- Reject a finding that contradicts the story or the human's instructions. Write down why in the review file.
- Read the file the agent wrote when the summary is not enough. Do not redo the work in your own context.

## 6. Story workflow

Load the `stories` skill to write or split stories.

1. **Pick.** Choose the next story from the map. Check `depends_on` and open decisions.
2. **Ready.** Run `node <storiesDir>/stories.mjs --ready <ID>`. Fix what you can. Product questions go to the human, batched. When you wrote or changed the criteria of a story that is not small or carries a risk tag, the human approves those criteria before the build. Batch the approvals: one message for every story about to start.
3. **Branch.** `story/<ID>-<slug>`. A writer gets its own workspace: `isolation: worktree` through the Agent tool, `--worktree new-child` in Orca. Declare its role before dispatching it (`references/harness.md`, **The guard**), or the role rules stop applying to it.
4. **Build.** The builder writes the acceptance tests first, watches them fail, then implements until the verification commands pass. One run, red to green. When `.orchestrator.json` has `ui` and the harness exposes a browser (`references/harness.md`, **Browser**), the brief also asks for the UI check of builder rule 11. Only one agent drives the browser at a time.
5. **Lock.** As soon as the builder reports DONE, add the acceptance-test files to `.orchestrator/locked-tests.txt`, with the helpers they import and the test runner's config. Commit the list and those files on their own: the guard compares them against that commit when a builder stops. From here no agent can edit them, so the fix loop cannot weaken them.
6. **Review.** One fresh `reviewer` judges the diff against the story: tests first (do they observe each criterion?), then story compliance, then code quality. It trusts the builder's command output and the CI result, and runs a check of its own only to probe a doubt. A second reviewer joins only for a risk tag that names its concern: a security role for a security tag, `copywriter` or `designer` when the story changes user-facing text or UI and the project names them. Each extra reviewer costs a whole agent session per story.
7. **Fix round.** Critical and Important findings go back once, to a builder on the same branch: in Orca a fresh builder in the same worktree, with a fix brief (`references/harness.md`). The re-review checks only the fix. Minor findings go to the ledger and never start a round. After the one round, rule on what is left, or escalate it if it is a product call. A defect that predates the story goes to the ledger as its own item, unless the story's diff touches the same lines. Never fix findings yourself while a builder owns the story. A finding against a locked test is the only reason to unlock it without the human: remove that one file from the list, commit, send the fix, and lock it again when the fix is DONE.
8. **Update the story.** Set each criterion's marker, using the markers in the `stories` skill. Run `stories.mjs --tests`; a criterion becomes a test marker only when its test passes there.
9. **Commit.** Apart from the lock commits, you commit once per story on its branch, staging files by name. You merge or rebase story branches yourself, never a builder: the merge often changes `locked-tests.txt`, and the guard stops a builder there.
10. **Human.** Queue the story for acceptance (§7).

**Irreversible steps inside a story** (a data migration, a deletion, a call to a live external service): the builder stops before the step and reports BLOCKED with what it will do. You take it to the human as an item of §7.1. Everything before the step continues.

**Small stories** (2 criteria or fewer, no risk tag): do steps 4 to 9 yourself, then run one `reviewer`. Skip the builder and the fix loop.

When behaviour changes later, edit the existing story's criteria. Do not write a new story on top. A bug is a failing marker on the criterion it breaks, not a new story.

## 7. When the human is involved

Contact the human only for:
1. **Irreversible or outward-facing actions:** push, merge, deploy, publish, send, delete data, spend money.
2. **Product calls:** scope, criteria you wrote for a story that is not small (§6.2), discarding a story, opening or closing a decision, anything that changes what the product is.
3. **What a machine cannot verify:** the runner limit in `.orchestrator.json`.
4. **Final acceptance of each story,** against the evidence.

Batch items 3 and 4 into one pass at the end of a block of work. Items 1 and 2 stop the affected work; other work continues.

Everything else proceeds without asking when the tests pass, the reviews are clean and no risk tag is set. Make routine technical choices yourself and log them as rulings.

When you ask: give a short summary, name the decision, give your recommendation and its reason, and wait. One message, all questions at once.

## 8. Git

Read `references/git.md`. In short: one branch per story, one worktree per parallel writer, one batched commit per story with files named, push and merge only on the human's request. The guard hook blocks the dangerous commands. A workspace that is a plain folder and not a repository has none of this: the verification commands are then the only evidence, and the close report says so.

## 9. Close

At the end of a block of work:
1. Run `verify.all` from `.orchestrator.json` once for the block, then `node <storiesDir>/stories.mjs --tests`. Builders run only the fast `verify.onBuilderStop`; the full set runs here, or in CI.
2. Settle the helpers. In Orca: every expected Dispatch has an outcome, every settled terminal was retained or released, every released terminal you launched is closed, every writer worktree you created is removed or named in the report, `worker-list --run <id> --terminal-state reclaimable --json` returns none, and the role file of each released worker is gone. Do not end the turn before that.
3. Write the lessons into the `Lessons` section of `CLAUDE.md`. A lesson enters only if a real failure in this project caused it; note that failure in one line next to the rule.
4. Update `.orchestrator/state.md`.
5. Give the human the batched review list: one line per item, bad news first. Include the roles you created or retired, your technical rulings, and any work that ran unsupervised. Name every branch with commits that are not on the remote, with its count, and every finished story branch that is not merged. Ask once whether to push and merge them; work that lives on one machine only is lost with it.
