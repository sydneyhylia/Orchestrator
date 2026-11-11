#!/usr/bin/env node
/**
 * Launches one supervised Orca worker in one command, with the steps of references/harness.md
 * (Launch, The guard) in order:
 *
 *   1. resolve the workspace: `current` (the main checkout) or `branch:<branch>` (a writer's worktree);
 *   2. refuse a second worker with the same role and scope there (by role file: Claude renames its tab);
 *   3. open the terminal in the worker permission mode;
 *   4. write the role file `<workspace>/.orchestrator/roles/<handle>.json`, with `base` for writers;
 *   5. with --close-shells, close the plain shells of a writer's worktree you created;
 *   6. wait for the session, and stop on a prompt (trust, MCP, bypass warning): those are the human's;
 *   7. dispatch the brief as the spec, from its file.
 *
 * Usage, from the project root:
 *   node <skill dir>/scripts/dispatch.mjs --role <role> --scope <scope> --brief <brief.md>
 *     --worktree <current | branch:<branch>> --run <run id>
 *     [--mode <permission mode>] [--read-only] [--close-shells] [--keep-open] [--terminal <handle>] [--dry-run]
 *
 * --mode is required when .orchestrator.json has no orca.workerPermissionMode: pass your own session's mode.
 * --read-only tightens a writing role for this dispatch (a reviewing copywriter); it never loosens one.
 * --terminal resumes a launch that stopped at a prompt, after the human answered it.
 * Prints one JSON line: { title, handle, dispatchId, workspace, roleFile }.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The plugin's own roles. A project role, or a different verdict on one of these, goes in
// .orchestrator.json → roles.<name>.readOnly.
export const PLUGIN_ROLES = { builder: false, copywriter: false, reviewer: true, researcher: true, designer: true };
export const PERMISSION_MODES = ["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"];
const SHELL_TITLE = /^(Terminal \d+|.*\b(powershell|pwsh|cmd)(\.exe)?|bash|zsh|sh|fish)$/i;
const stripBom = (s) => s.replace(/^﻿/, "");

export function parseArgs(argv) {
  const args = { keepOpen: false, dryRun: false, readOnly: false, closeShells: false };
  const flags = { "--keep-open": "keepOpen", "--dry-run": "dryRun", "--read-only": "readOnly", "--close-shells": "closeShells" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags[a]) args[flags[a]] = true;
    else if (a.startsWith("--")) args[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  return args;
}

/** true or false for a known role, undefined for an unknown one. The config wins over the plugin. */
export function roleReadOnly(role, config) {
  const declared = config?.roles?.[role]?.readOnly;
  return typeof declared === "boolean" ? declared : PLUGIN_ROLES[role];
}

/** The worker mode, or a problem. Pure, so it can be checked without Orca. */
export function workerMode(config, given) {
  const fromConfig = config?.orca?.workerPermissionMode;
  const mode = (fromConfig || given) === "default" ? "manual" : fromConfig || given;
  if (!mode) return { problem: "no orca.workerPermissionMode in .orchestrator.json: pass --mode <your own session's permission mode>" };
  if (fromConfig && given && given !== mode) return { problem: `--mode ${given} differs from orca.workerPermissionMode ${mode}` };
  if (!PERMISSION_MODES.includes(mode)) return { problem: `"${mode}" is not a permission mode (${PERMISSION_MODES.join(", ")})` };
  return { mode };
}

/** What is wrong with the arguments, or null. Pure. */
export function argsProblem(a, config) {
  if (!a.role || !a.scope || !a.brief || !a.worktree || !a.run) return "needs --role, --scope, --brief, --worktree and --run";
  const declared = roleReadOnly(a.role, config);
  if (declared === undefined) return `unknown role "${a.role}": declare it in .orchestrator.json → roles.${a.role}.readOnly`;
  const readOnly = declared || a.readOnly;
  if (a.worktree !== "current" && !a.worktree.startsWith("branch:")) return "--worktree is current or branch:<branch>";
  if (!readOnly && a.worktree === "current") return `${a.role} writes: give it its own worktree with --worktree branch:<branch>, never current`;
  if (readOnly && a.worktree !== "current") return `${a.role} is read-only here: use --worktree current`;
  if (!/^[\w.-]+$/.test(a.scope)) return `scope "${a.scope}" must be a story ID or a short topic (letters, digits, . _ -)`;
  if (a.closeShells && a.worktree === "current") return "--close-shells only in a writer's worktree: the shells on current are yours and the human's";
  return null;
}

export const titleOf = (a) => `${a.role}-${a.scope}`;

export function roleFile(a, readOnly, base) {
  const file = { role: a.role, scope: a.scope, readOnly };
  if (!readOnly && base) file.base = base;
  return file;
}

const fail = (message) => {
  console.error(`orchestrator dispatch: ${message}`);
  process.exit(1);
};

// Orca prints JSON on success and on failure; a failure also exits non-zero.
function orca(args) {
  let out;
  try {
    out = execFileSync("orca", [...args, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    out = e.stdout || "";
    if (!out.trim()) fail(`orca ${args.slice(0, 2).join(" ")} failed: ${(e.stderr || e.message).trim()}`);
  }
  let data;
  try { data = JSON.parse(out); } catch { fail(`orca ${args.slice(0, 2).join(" ")} printed no JSON: ${out.slice(0, 300)}`); }
  if (!data.ok) fail(`orca ${args.slice(0, 2).join(" ")}: ${JSON.stringify(data.error ?? data)}`);
  return data.result;
}

function readConfig(root) {
  const file = join(root, ".orchestrator.json");
  if (!existsSync(file)) fail(`${root} has no .orchestrator.json: run it from the project root`);
  try { return JSON.parse(stripBom(readFileSync(file, "utf8"))); } catch (e) { fail(`.orchestrator.json is not valid JSON (${e.message})`); }
}

function workspacePath(selector, root) {
  if (selector === "current") return root;
  const branch = selector.slice("branch:".length);
  // A bare path selector failed on Orca 1.4.250; the branch selector works.
  const found = (orca(["worktree", "list"]).worktrees ?? []).find((w) => w.branch === branch || w.branch === `refs/heads/${branch}`);
  if (!found) fail(`no Orca worktree on branch ${branch}: create it first with orca worktree create`);
  return found.path.replace(/\\/g, "/");
}

function headOf(dir) {
  try { return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; } // A folder workspace has no commit to start from.
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const root = resolve(process.cwd());
  const config = readConfig(root);
  const problem = argsProblem(a, config);
  if (problem) fail(problem);
  const { mode, problem: modeProblem } = workerMode(config, a.mode);
  if (modeProblem) fail(modeProblem);
  const brief = resolve(a.brief);
  if (!existsSync(brief)) fail(`brief not found: ${brief}`);

  const readOnly = roleReadOnly(a.role, config) || a.readOnly;
  const workspace = workspacePath(a.worktree, root);
  if (!existsSync(join(workspace, ".orchestrator.json"))) fail(`${workspace} has no .orchestrator.json: the guard would not hold this worker`);
  const title = titleOf(a);
  const rolesDir = join(workspace, ".orchestrator", "roles");
  const roleOf = (handle) => {
    try { return JSON.parse(stripBom(readFileSync(join(rolesDir, `${handle.replace(/[^\w.-]/g, "_")}.json`), "utf8"))); } catch { return null; }
  };
  const open = orca(["terminal", "list", "--worktree", a.worktree]).terminals ?? [];
  const twin = open.find((t) => t.handle !== a.terminal && roleOf(t.handle)?.role === a.role && roleOf(t.handle)?.scope === a.scope);
  if (twin) fail(`${title} is already open in ${a.worktree} (${twin.handle}): send it a message instead`);

  const file = roleFile(a, readOnly, readOnly ? null : headOf(workspace));
  if (a.dryRun) {
    console.log(JSON.stringify({ dryRun: true, title, workspace, mode, roleFile: file, brief }));
    return;
  }

  const handle = a.terminal
    ?? orca(["terminal", "create", "--worktree", a.worktree, "--title", title, "--command", `claude --permission-mode ${mode}`]).terminal.handle;
  mkdirSync(rolesDir, { recursive: true });
  const rolePath = join(rolesDir, `${handle.replace(/[^\w.-]/g, "_")}.json`);
  if (!a.terminal || !existsSync(rolePath)) writeFileSync(rolePath, `${JSON.stringify(file)}\n`);

  if (a.closeShells && !a.terminal) {
    for (const t of open) if (t.handle !== handle && SHELL_TITLE.test(t.title ?? "")) orca(["terminal", "close", "--terminal", t.handle]);
  }

  const resume = `answer nothing yourself; when the human has, rerun this command with --terminal ${handle}`;
  const { wait } = orca(["terminal", "wait", "--terminal", handle, "--for", "tui-idle", "--timeout-ms", "60000"]);
  if (!wait?.satisfied || wait.blockedReason) {
    fail(`${title} (${handle}) is not ready: ${wait?.blockedReason ?? "timeout"}. Read it with orca terminal read; a prompt there is the human's to answer. Then ${resume}.`);
  }

  const start = ["orchestration", "worker-start", "--run", a.run, "--terminal", handle, "--worktree", a.worktree, "--spec-file", brief, "--task-title", title];
  if (a.keepOpen) start.push("--keep-open");
  const { dispatchId } = orca(start);
  console.log(JSON.stringify({ title, handle, dispatchId, workspace, roleFile: rolePath }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
