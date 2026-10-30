#!/usr/bin/env node
// orchestrator guard. Claude Code hook for SessionStart, PreToolUse and SubagentStop.
// Inert unless the repository has .orchestrator.json at its root.
// Exit 0 = allow. Exit 2 = block; stderr goes back to Claude. Exit 0 with permissionDecision "ask" on
// stdout = Claude Code asks the human to confirm.

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const WIN = process.platform === "win32";
const stripBom = (s) => s.replace(/^﻿/, "");
const input = JSON.parse(stripBom(readFileSync(0, "utf8")) || "{}");
const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

function block(reason) {
  process.stderr.write(`orchestrator: ${reason}\n`);
  process.exit(2);
}

// A command the human must confirm. It is reported only after every other check on the line passed,
// so a blocked command never reaches the prompt.
let confirmReason = null;
const confirm = (reason) => { confirmReason ??= `orchestrator: ${reason}`; };

function toplevel(dir) {
  let d = path.resolve(dir);
  while (!existsSync(d) && path.dirname(d) !== d) d = path.dirname(d);
  try { return path.resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: d, stdio: ["ignore", "pipe", "ignore"] }).toString().trim()); }
  catch { return null; }
}

// The checkout the session works in. A worktree has its own toplevel and its own branch.
const root = toplevel(cwd) ?? path.resolve(process.env.CLAUDE_PROJECT_DIR || cwd);
// Projects installed before the rename keep .orquestador.json and .orquestador/ until they migrate.
const STATE = existsSync(path.join(root, ".orchestrator.json")) || !existsSync(path.join(root, ".orquestador.json")) ? ".orchestrator" : ".orquestador";
const configPath = path.join(root, `${STATE}.json`);
if (!existsSync(configPath)) process.exit(0);

let config;
try { config = JSON.parse(stripBom(readFileSync(configPath, "utf8"))); }
catch (e) { block(`${STATE}.json is not valid JSON (${e.message}). Fix it before continuing.`); }

const git = config.git ?? {};
const protectedBranches = git.protectedBranches ?? ["main", "master"];
const broadAddBlocked = git.blockBroadAdd !== false;
// The role of this session. A Claude Code subagent carries it in agent_type. An Orca worker is a
// whole session and carries none, so the orchestrator declares it in the worker's workspace, in a
// file named after the worker's terminal: Orca gives every terminal ORCA_TERMINAL_HANDLE, and the
// orchestrator's own terminal has another handle, so a worker on the main checkout cannot gag it.
function readRole(file) {
  try { return JSON.parse(stripBom(readFileSync(file, "utf8"))); }
  catch (e) { block(`${path.relative(root, file)} is not valid JSON (${e.message}). Fix it or delete it.`); }
}
function declaredRole() {
  const handle = process.env.ORCA_TERMINAL_HANDLE;
  const byHandle = handle && path.join(root, STATE, "roles", `${handle.replace(/[^\w.-]/g, "_")}.json`);
  if (byHandle && existsSync(byHandle)) return readRole(byHandle);
  // Before 0.4.0: one role.json per linked worktree. In the main checkout it would gag the orchestrator.
  const file = path.join(root, STATE, "role.json");
  if (!existsSync(file)) return null;
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (!gitDir.split(path.sep).join("/").includes("/worktrees/")) return null;
  } catch { /* folder workspace: nothing to compare, trust the file */ }
  const role = readRole(file);
  // A copy that travelled with the branch names someone else's workspace. Ignore it.
  return role.workspace && path.resolve(role.workspace) !== root ? null : role;
}

const declared = input.agent_type ? null : declaredRole();
const agentType = String(input.agent_type ?? "") || String(declared?.role ?? "");
const inSubagent = Boolean(agentType);
const isRole = (r) => new RegExp(`(^|:)${r}$`).test(agentType);
// A worker's role file says whether it may write. A subagent is also held by its own tools list.
const readOnlyRole = typeof declared?.readOnly === "boolean" ? declared.readOnly : ["reviewer", "researcher", "designer"].some(isRole);

// Paths are compared repo-relative, so a worktree copy of a locked file matches too.
const key = (p) => { const k = p.split(path.sep).join("/").replace(/^\.\//, ""); return WIN ? k.toLowerCase() : k; };
const relTo = (base, p) => key(path.relative(base, path.resolve(base, p)));
const LOCK_REL = key(`${STATE}/locked-tests.txt`);
const lockFile = path.join(root, STATE, "locked-tests.txt");
const lockedPaths = existsSync(lockFile)
  ? stripBom(readFileSync(lockFile, "utf8")).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
  : [];
const locked = new Set(lockedPaths.map(key));
// A directory that holds a locked file: deleting or moving it takes the file with it.
const holdsLocked = (rel) => rel === "" || [...locked].some((l) => l.startsWith(rel + "/"));
const storiesRel = config.storiesDir ? key(path.join(config.storiesDir, "stories")) + "/" : null;
const mapRel = config.storiesDir ? key(path.join(config.storiesDir, "map.md")) : null;

function currentBranch(dir) {
  try { return execFileSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return null; }
}

// ---------- SessionStart: load the procedure

if (input.hook_event_name === "SessionStart") {
  // Detected now, from this session's environment: a harness line in the ledger can be stale.
  const orca = process.env.TERM_PROGRAM === "Orca" || Object.keys(process.env).some((k) => k.startsWith("ORCA_"));
  const harness = orca
    ? "Harness, detected now: Orca. Delegate through supervised workers (references/harness.md), whatever the ledger says."
    : "Harness, detected now: plain Claude Code.";
  // A worker's session starts before the orchestrator dispatches it, so its role is not known yet:
  // the worker tells itself apart by its first prompt, and the Skill check below holds it.
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart",
    additionalContext: `This project uses orchestrator. If your first prompt is an Orca worker spec or a role brief, you are that role: follow it and do not load orchestrator:orchestrate. Otherwise you are the orchestrator: load the orchestrator:orchestrate skill before any work and follow it. ${harness}` } }));
  process.exit(0);
}

// ---------- PreToolUse: a role never takes the orchestrator's procedure

if (input.hook_event_name === "PreToolUse" && input.tool_name === "Skill" && inSubagent
  && /(^|:)orchestrate$/.test(String(input.tool_input?.skill ?? ""))) {
  block(`you are ${agentType}, not the orchestrator. Follow your spec; ask the orchestrator through \`orca orchestration ask\` when it does not cover something.`);
}

// ---------- PreToolUse: file edits

function checkFileWrite(rel, absolute) {
  if (locked.has(rel)) block(`${rel} is a locked acceptance test. Report the problem instead of changing the test; only the orchestrator unlocks it, on the product owner's request.`);
  if (rel === mapRel) block(`${rel} is generated. Change the stories and run stories.mjs instead.`);
  if (inSubagent && rel === LOCK_REL) block("subagents cannot change the locked-tests list.");
  if (isRole("builder") && storiesRel && rel.startsWith(storiesRel)) block("the builder does not edit story files. Report the criterion status; the orchestrator updates the markers.");
  if (readOnlyRole && !key(absolute).includes(`/${STATE}/work/`)) block(`${agentType} is read-only. It writes only its report under .orchestrator/work/.`);
}

if (input.hook_event_name === "PreToolUse" && ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(input.tool_name)) {
  const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!target) process.exit(0);
  const abs = path.resolve(cwd, target);
  const base = toplevel(path.dirname(abs)) ?? root;
  checkFileWrite(relTo(base, abs), abs);
  process.exit(0);
}

// ---------- PreToolUse: shell commands

// Split a command line into simple commands. Quoted text is kept apart: it is checked
// as a command of its own only when it is itself a git or shell call (bash -c "git push").
function commands(line) {
  const quoted = [];
  const bare = line.replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g, (_, d, s) => { quoted.push(d ?? s); return ` __Q${quoted.length - 1}__ `; });
  const out = [];
  for (const seg of bare.split(/&&|\|\||;|\||\n|\$\(|`|\(|\)/)) {
    const tokens = seg.trim().split(/\s+/).filter(Boolean);
    if (tokens.length) out.push(tokens.map((t) => t.replace(/__Q(\d+)__/g, (_, i) => quoted[i])));
  }
  for (const q of quoted) if (/^\s*(\S*[\\/])?git(\.exe)?\s/i.test(q) || /^\s*(bash|sh|pwsh|powershell)\b/i.test(q)) out.push(...commands(q));
  return out;
}

const isGit = (t) => /(^|[\\/])git(\.exe)?$/i.test(t);

function checkGit(args) {
  // Skip global options to find the subcommand: git -C dir -c k=v push ...
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    if (args[i] === "-c" && /^core\.hookspath=/i.test(args[i + 1] ?? "")) block("overriding core.hooksPath skips the project's hooks.");
    i += /^(-C|-c|--git-dir|--work-tree|--namespace)$/.test(args[i]) ? 2 : 1;
  }
  const sub = (args[i] ?? "").toLowerCase();
  const rest = args.slice(i + 1);
  const has = (re) => rest.some((a) => re.test(a));
  const dirArg = args.indexOf("-C") >= 0 ? path.resolve(cwd, args[args.indexOf("-C") + 1] ?? ".") : cwd;

  if (sub === "push") {
    if (has(/^(--force|--force-with-lease|--force-if-includes)/) || has(/^-[a-z]*f/i) || has(/^\+/)) block("force push is blocked.");
    if (has(/^--no-verify$/)) block("--no-verify is blocked. Fix the failing hook instead.");
    if (inSubagent) block("role agents never push. Report DONE; the orchestrator pushes when the product owner asks.");
    if (git.allowPush === false) confirm("git.allowPush is false in this project, so every push needs the product owner's confirmation.");
  }
  if (sub === "commit") {
    if (has(/^--no-verify$/) || has(/^-[a-z]*n/i)) block("skipping commit hooks is blocked. Fix the failing hook instead.");
    if (broadAddBlocked && (has(/^--all$/) || has(/^-[a-z]*a/i))) block("`git commit -a` stages everything. Stage the story's files by name.");
    const b = currentBranch(dirArg);
    if (b && protectedBranches.includes(b)) block(`commits on ${b} are blocked. Create the story branch first.`);
    // A role must not commit a change to a locked file: the Stop check compares against HEAD.
    if (inSubagent) {
      let staged = [];
      try { staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: dirArg, stdio: ["ignore", "pipe", "ignore"] }).toString().split(/\r?\n/).filter(Boolean).map(key); }
      catch { /* not a repository: nothing staged */ }
      const hit = staged.find((f) => locked.has(f) || f === LOCK_REL);
      if (hit) block(`${hit} is locked. Unstage it; only the orchestrator commits changes to locked files.`);
    }
  }
  if (["merge", "rebase", "cherry-pick", "pull", "am", "revert"].includes(sub)) {
    const b = currentBranch(dirArg);
    if (b && protectedBranches.includes(b)) block(`git ${sub} on ${b} is blocked. Merging into ${b} happens only on the product owner's request.`);
  }
  if (sub === "add" && broadAddBlocked && rest.some((a) => /^(-A|--all|-u|--update|\.|\.\/|:\/|\*)$/.test(a))) {
    block("broad `git add` is blocked. Stage the story's files by name.");
  }
  if (sub === "reset" && has(/^--hard$/)) block("git reset --hard is blocked. It discards work.");
  if (sub === "clean" && has(/^-[a-z]*f/i)) block("git clean -f is blocked. It deletes untracked files.");
  if ((sub === "checkout" || sub === "restore") && rest.some((a) => a === "." || a === ":/")) block(`git ${sub} . discards every uncommitted change. Name the files instead.`);
  // Restoring a locked file to HEAD is how a role undoes a change to it, so that stays allowed.
  const toHead = (sub === "restore" && !has(/^(-s|--source)/))
    || (sub === "checkout" && rest.includes("--") && rest.slice(0, rest.indexOf("--")).every((a) => /^HEAD$/i.test(a)));
  if (["rm", "mv"].includes(sub)) checkPaths(sub === "mv" ? rest.slice(0, -1) : rest, dirArg, true);
  if (["rm", "mv", "checkout", "restore"].includes(sub) && !toHead) checkPaths(rest, dirArg);
}

const WRITERS = /^(rm|del|erase|rmdir|mv|move|cp|copy|tee|sed|truncate|remove-item|move-item|copy-item|set-content|add-content|out-file|clear-content|new-item)$/i;
const REMOVERS = /^(rm|del|erase|rmdir|rd|mv|move|remove-item|move-item|ri|mi)$/i;
// The values `claude --permission-mode` accepts. Hooks can report the normal mode as "default",
// which the CLI calls "manual".
const PERMISSION_MODES = ["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"];
const cliMode = (m) => (m === "default" ? "manual" : m);

function checkPaths(tokens, dir, removes = false) {
  const base = toplevel(dir) ?? root;
  for (const t of tokens) {
    const p = t.replace(/^[<>]+/, "").replace(/^(-\w+:)/, "");
    if (!p || p.startsWith("-")) continue;
    const rel = relTo(base, path.resolve(dir, p));
    if (locked.has(rel)) block(`${rel} is a locked acceptance test. It cannot be changed, moved or deleted.`);
    if (removes && !rel.startsWith("..") && holdsLocked(rel)) block(`${rel || "."} holds locked acceptance tests. It cannot be moved or deleted.`);
    if (inSubagent && rel === LOCK_REL) block("subagents cannot change the locked-tests list.");
    if (isRole("builder") && storiesRel && rel.startsWith(storiesRel)) block("the builder does not edit story files. Report the criterion status; the orchestrator updates the markers.");
    if (rel === mapRel) block(`${rel} is generated. Change the stories and run stories.mjs instead.`);
  }
}

if (input.hook_event_name === "PreToolUse" && ["Bash", "PowerShell"].includes(input.tool_name)) {
  const cmds = commands(String(input.tool_input?.command ?? "").replace(/\d*>&\d/g, " "));
  // The branch check reads HEAD before the command runs, so a switch and a commit must not share a command.
  const gitSubs = cmds.filter((c) => isGit(c[0]) || isGit(c[1] ?? "")).map((c) => c.join(" ").toLowerCase());
  if (gitSubs.some((c) => /\s(switch|checkout)\s/.test(c + " ")) && gitSubs.some((c) => /\scommit(\s|$)/.test(c))) {
    block("run the branch switch and the commit as separate commands.");
  }
  for (const raw of cmds) {
    // Strip wrappers and VAR=value prefixes: `HUSKY=0 git commit` is still a git commit.
    let s = 0;
    while (s < raw.length && (/^(rtk|sudo|command|exec|env|nohup|time|&)$/i.test(raw[s]) || /^\$?(env:)?[A-Za-z_]\w*=/.test(raw[s]))) {
      if (/^\$?(env:)?HUSKY=0/i.test(raw[s])) block("HUSKY=0 skips the commit hooks. Fix the failing hook instead.");
      s++;
    }
    const tokens = raw.slice(s);
    if (!tokens.length) continue;
    if (isGit(tokens[0])) {
      if (readOnlyRole && !/^(status|diff|log|show|blame|grep|ls-files|rev-parse|branch|remote)$/i.test(tokens.find((t, i) => i > 0 && !t.startsWith("-")) ?? "")) block(`${agentType} is read-only. It may only run git commands that read.`);
      checkGit(tokens.slice(1));
      continue;
    }
    // Orca workers run in orca.workerPermissionMode, or else in this session's mode, never in Orca's
    // default arguments (harness.md, Launch).
    if (/^orca(\.exe)?$/i.test(tokens[0]) && tokens[1] === "worktree" && /^(rm|remove)$/.test(tokens[2] ?? "") && tokens.includes("--force")) block("orca worktree rm --force discards uncommitted work. Remove it without --force, or leave it and name it in the close report.");
    const workerMode = cliMode(config.orca?.workerPermissionMode || input.permission_mode);
    if (/^orca(\.exe)?$/i.test(tokens[0]) && workerMode) {
      if (!PERMISSION_MODES.includes(workerMode)) block(`orca.workerPermissionMode "${workerMode}" is not a permission mode (${PERMISSION_MODES.join(", ")}). Fix .orchestrator.json.`);
      const want = `--permission-mode ${workerMode}`;
      const from = config.orca?.workerPermissionMode ? "orca.workerPermissionMode" : "this session's mode";
      if (tokens[1] === "orchestration" && tokens[2] === "worker-start" && tokens.includes("--agent")) block(`launch the worker's terminal yourself with \`orca terminal create --command "claude ${want}"\`, then \`worker-start --terminal <handle>\`. --agent uses Orca's default arguments.`);
      const cmd = tokens[tokens.indexOf("--command") + 1] ?? "";
      if (tokens[1] === "terminal" && tokens[2] === "create" && /(^|[;&|]\s*)claude\b/i.test(cmd) && !cmd.includes(want)) block(`start the worker in ${from}: --command "claude ${want}".`);
    }
    if (/^gh$/i.test(tokens[0]) && /^pr$/i.test(tokens[1] ?? "") && /^merge$/i.test(tokens[2] ?? "")) {
      if (inSubagent) block("role agents never merge. The product owner merges, or asks the orchestrator to.");
      if (git.allowPush === false) confirm("git.allowPush is false in this project, so every merge needs the product owner's confirmation.");
    }
    // Redirections write too: split "x>file" and "> file" into their own tokens.
    const split = tokens.flatMap((t) => t.split(/(>>?)/)).filter(Boolean);
    const redirTargets = split.filter((t, i) => i > 0 && /^>>?$/.test(split[i - 1]));
    if (WRITERS.test(tokens[0])) checkPaths(tokens.slice(1), cwd);
    if (REMOVERS.test(tokens[0])) checkPaths(/^(mv|move|move-item|mi)$/i.test(tokens[0]) ? tokens.slice(1, -1) : tokens.slice(1), cwd, true);
    if (redirTargets.length) checkPaths(redirTargets, cwd);
    if (readOnlyRole) {
      const targets = [...(WRITERS.test(tokens[0]) ? tokens.slice(1).filter((t) => !t.startsWith("-")) : []), ...redirTargets]
        .filter((t) => !/^&?\d*$/.test(t) && !/^\/dev\/null$|^\$null$|^nul$/i.test(t));
      const outside = targets.find((t) => !key(path.resolve(cwd, t)).includes(`/${STATE}/work/`));
      if (outside) block(`${agentType} is read-only. It writes only its report under .orchestrator/work/ (not ${outside}).`);
    }
  }
  if (confirmReason) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse",
    permissionDecision: "ask", permissionDecisionReason: confirmReason } }));
  process.exit(0);
}

// ---------- Stop and SubagentStop: the builder does not stop on red
// SubagentStop fires for a Claude Code subagent; Stop fires at the end of a turn, which is how an
// Orca worker finishes. In the orchestrator's own session there is no role, so Stop exits at once.

if (input.hook_event_name === "SubagentStop" || input.hook_event_name === "Stop") {
  if (!isRole("builder")) process.exit(0);
  // Content, not command shape: whatever tool changed a locked file, the story files or the lock
  // list, the difference from HEAD shows it. This check ignores stop_hook_active: the builder
  // restores the files (git restore <file>) or stops for good only by reporting BLOCKED.
  const spec = (list) => list.map((p) => (WIN ? `:(icase)${p}` : p));
  const lockSet = spec([...lockedPaths, `${STATE}/locked-tests.txt`]);
  const run = (a) => { try { return execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
  const names = (a) => run(a).split(/\r?\n/).filter(Boolean);
  const changed = names(["diff", "--name-only", "HEAD", "--", ...lockSet, ...spec(storiesRel ? [storiesRel, mapRel] : [])]);
  if (changed.length) block(`these locked or orchestrator-owned files differ from HEAD: ${changed.join(", ")}. Restore them with \`git restore <file>\`, then report what you needed to change them for.`);
  // A commit made through an interpreter leaves the tree equal to HEAD. The orchestrator commits each
  // lock, so the last commit that touched the lock list is the base the locked files must still match.
  // When the role file names the commit the builder started from, only the builder's own commits
  // count: a merge, a commit made outside the flow, or the orchestrator's lock commit (it changes the
  // lock list) is not the builder's to answer for.
  const start = declared?.base;
  const base = start || run(["log", "-1", "--format=%H", "--", `${STATE}/locked-tests.txt`]);
  let committed = [];
  if (start) {
    for (const sha of names(["log", "--no-merges", "--format=%H", `${start}..HEAD`, "--", ...lockSet])) {
      const files = names(["show", "--format=", "--name-only", sha]);
      if (!files.some((f) => key(f) === LOCK_REL)) committed.push(...files.filter((f) => locked.has(key(f))));
    }
    committed = [...new Set(committed)];
  } else if (base) committed = names(["diff", "--name-only", base, "HEAD", "--", ...lockSet]);
  if (committed.length && !input.stop_hook_active) block(`locked files were committed after the lock (${base.slice(0, 7)}): ${committed.join(", ")}. Do not undo it yourself. Report BLOCKED and name these files and the commit.`);
  if (input.stop_hook_active) process.exit(0); // One retry for the verification commands; then the builder reports honestly.
  const deadline = Date.now() + 1000 * 1000; // Stay inside the hook timeout in hooks.json.
  for (const c of config.verify?.onBuilderStop ?? []) {
    const left = deadline - Date.now();
    if (left <= 0) block("the verification checks ran out of time. Report the unchecked commands as ⚠️.");
    try { execSync(c, { cwd: root, stdio: ["ignore", "pipe", "pipe"], timeout: left, maxBuffer: 64 * 1024 * 1024 }); }
    catch (e) {
      const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.split(/\r?\n/).slice(-40).join("\n");
      block(`\`${c}\` failed. Fix it, or report it as ❌ with this output:\n${out}`);
    }
  }
  process.exit(0);
}

process.exit(0);
