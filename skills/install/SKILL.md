---
name: install
description: Install orchestrator in one project. Measures the project, writes .orchestrator.json, the story folder and validator in the project's language, project roles and a CLAUDE.md block, and migrates an existing story folder. Run only when the human asks for /orchestrator:install. Not for spec-driven (SDD) setups.
disable-model-invocation: true
---

# Install

The install has three layers. Store each one in its own place:

- **Method:** fixed. It lives in the plugin (`orchestrate`, `stories`, the agents, the guard). Never copy it into the project.
- **Plugs:** measured in this repo. Commands, paths, limits, seams, roles, language. They go into `.orchestrator.json` and the `CLAUDE.md` block.
- **Lessons:** start empty. Only real failures in this project add them, at close time.

Never copy a rule or a lesson from another project.

## Step 0: scope

Run `claude plugin list --json` and read the scope of `orchestrator@orchestrator-local`. If the scope is `project` or `local`, go to step 1.

If the scope is `user`, the plugin loads in every project on this machine. Ask the human once: "Keep orchestrator in every project, or only in this one?"

- **Every project:** go to step 1.
- **Only this one:** also ask whether the team shares it. `project` writes `.claude/settings.json`, which git shares. `local` writes `.claude/settings.local.json`, which git ignores. Then run, from the repo root:

```
claude plugin install orchestrator@orchestrator-local --scope <project|local>
claude plugin uninstall orchestrator@orchestrator-local --scope user
```

Tell the human to restart the CLI after the install, and continue with step 1.

## Step 1: measure

Run things. Do not read them off `package.json` or a README.

1. **Verification commands.** Find the lint, typecheck, test and build commands. Run each one. Record the exact command, the time it took, and whether it was already red before any change. A command that does not run is not a plug.
2. **Test runner and report.** Find how to get a machine-readable result: Jest/Vitest `--reporter=json --outputFile=<file>`, or JUnit XML (pytest `--junitxml`, Go `go-junit-report`, most CI runners). Run it once.
3. **Runner limit.** Write a three-line test that checks something the runner cannot see (rendering, layout, a real network call, a real browser). Run it and watch it fail or pass vacuously. Record in one sentence what the tests cannot prove. The human reviews everything that sentence lists.
4. **Seams.** Find pairs of places that must change together with nothing in the language tying them: twin files, two emitters of the same data, a hand-written list mirroring another, a type mirroring an external constraint, a version bumped in two places, a whitelist of modules, two scripts writing the same file. For each seam pick one watcher: a test, deriving one side from the other, or a named person. Prove each TEST watcher once: break one side on purpose, run the watcher, confirm it fails, then revert. A watcher that stays green is ❌ in the install report; fix it or pick another watcher.
5. **Mutation (optional).** If the project already has a mutation tool, or one installs without new infrastructure for its stack, record a command that mutates only the changed files as `verify.mutation`. Otherwise remove the key. Do not add a tool only for this.
6. **Language.** Detect the language of the project's docs and UI. If they disagree, ask the human once.
7. **Roster.** Pick the roles the project needs with the tests in the `orchestrate` skill's `references/roles.md`. Write project roles into `.claude/agents/` from `references/role-template.md`. List each role with one line on why it exists.

Ask the human only what you cannot measure, all at once: the product's personas, the release names, the risk tags that matter, the code owner if any, and whether agents may check the UI in a browser during the build. If yes, also ask which test data agents may touch. The `ui` key is that permission: remove it when the answer is no. In Orca, also ask which permission mode the workers launch in; `bypassPermissions` means they never stop to ask. That answer is `orca.workerPermissionMode`: remove the key when the workers should run in the orchestrator's own mode.

## Step 2: write `.orchestrator.json`

Copy `assets/orchestrator.json` to the repo root as `.orchestrator.json` and fill every slot. Remove `copy` or `design` when the project has no copy master or design source. Do not leave a `{{` anywhere.

## Step 3: create the story folder

1. Create `<storiesDir>/` (default `product/`; use the project-language word if the project names folders in its language).
2. Copy `assets/stories.mjs` into it unchanged.
3. Write `<storiesDir>/stories.config.json` from `assets/stories.config.json`:
   - `labels` holds every heading, marker, status and map text **translated into the project's language**. Translate the English defaults in `stories.mjs` (`DEFAULTS`). If the project language is English, delete `labels`.
   - Translate the vague-word and hedge lists too. They are what the ready check flags.
   - Set `tests` from Step 1.
4. Write `<storiesDir>/activities.json` with the backbone activities. If none exist yet, write one activity and ask the human for the rest at the first story session.
5. Write `<storiesDir>/templates/story.md` and `templates/decision.md`: the plugin templates from `skills/stories/templates/`, translated into the project's language. Keep the frontmatter keys in English.
6. Write `<storiesDir>/README.md` from `assets/stories-readme.md`, translated.
7. Create `<storiesDir>/stories/` and `<storiesDir>/decisions/`.
8. Add `<storiesDir>/.test-results` to `.gitignore`.
9. Run `node <storiesDir>/stories.mjs --tests`. It must run clean on the empty folder. Use `--tests` here: a map generated without it says "no results", and the `--tests --check` in step 6 and CI then reports it stale.

All files the project reads are in one language: the project's.

## Step 4: write the CLAUDE.md block

Insert `assets/claude-md-block.md`, filled and translated, into the root `CLAUDE.md`. On a re-install, replace only the text between the markers. Keep the `Lessons` section below the markers: it belongs to the project, and a re-install never touches it. If it does not exist, add it below the block.

## Step 5: prepare git

1. Create `.orchestrator/` with an empty `locked-tests.txt` and a `state.md` that says "No work in progress." Add `.orchestrator/work/` and `.orchestrator/role.json` to `.gitignore`; keep `locked-tests.txt` and `state.md` tracked. `role.json` is per-workspace and must never travel with a branch.
2. If several people share the repository, offer the human the optional GitHub settings in the `orchestrate` skill's `references/git.md`. Do not apply them yourself.

## Step 6: verify the install

- `grep -r "{{" .orchestrator.json CLAUDE.md <storiesDir>` returns nothing.
- Every command in `.orchestrator.json` runs.
- Every path cited in the `CLAUDE.md` block exists.
- `node <storiesDir>/stories.mjs --tests --check` passes. CI runs the same command.
- The guard is active: ask the human to try `git push --force` in a fresh session and confirm it is blocked. If hooks do not run on this machine, record it in the `CLAUDE.md` block; the agents still carry the same rules in their prompts.
- **The delegation mechanism works.** Detect the harness (`orchestrate` skill → `references/harness.md`) and prove the chain once, now, with the smallest real delegation — not by reading the documentation. In Orca: bind a Run, dispatch one `researcher` on a throwaway question, and confirm `orca orchestration run-list --json`, `worker-list --run <id> --json` and `orca worktree ps` all show it; then release it. Before that, check folder trust, because no permission mode skips it: read the Claude profile Orca launches with: `claude-profiles/<id>/home/.claude.json` under Orca's app data folder when that exists, otherwise the user's own `~/.claude.json`. There `projects.<path>.hasTrustDialogAccepted` must be true for the repository and for Orca's worktree folder. A trusted parent is not proof. When `orca.workerPermissionMode` is `bypassPermissions`, also check `skipDangerousModePermissionPrompt`; if it is not true, the human accepts the warning once in an Orca Claude tab. When one is missing, tell the human which folder to trust (opening Claude there from Orca once and answering yes is enough) and never write the key yourself unless the human asks you to. If the worker stops at a launch prompt anyway, do not answer it: show it to the human. The chain is proven only when the worker runs a turn. In plain Claude Code: one Agent-tool subagent that returns a report file. Record the result in the `CLAUDE.md` block's **Delegation** line. A mechanism nobody has exercised is not installed.

Report each check as ✅ measured and working, ⚠️ not verified (with the manual step), ❌ failed.

## Migrating an existing story folder

When the project already has stories in another format:

1. Map its fields to the orchestrator keys (`id`, `title`, `activity`, `persona`, `release`, `blocked_by`, `depends_on`, `tags`, `screens`, `discarded`). Write the mapping down before changing files.
2. Map its markers and headings to `labels`. If the existing words already work, keep them as the labels instead of rewriting every file.
3. Rename the activity file keys to `code`, `name`, `folder`, `lane`, `purpose`.
4. Change files with a script, not by hand. Run the validator before and after; the number of stories and criteria must not change.
5. Fix the drift the validator now reports (for example activity names that no longer match). List what it found in the report.
6. Keep the old generator until the new one gives the same map. Then delete the old one in the same commit.
