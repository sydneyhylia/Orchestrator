---
name: stories
description: Write, split, review and maintain user stories in a project that uses orchestrator. Covers the story file format, acceptance criteria as rules plus key examples, verification markers, splitting patterns, decisions, and the anti-patterns the validator flags. Use when creating or editing a story, turning a request into stories, splitting a large story, checking if a story is ready, or recording that a criterion fails.
---

# Stories

Stories are the only product artifact. There is no separate spec layer. A story records what one person can do, and its criteria record exactly what is true. The tests are the executable proof. The map is generated.

Story files are written in the project's language. Frontmatter keys stay in English. This skill names headings and markers by their English defaults; the project's translated labels live in `stories.config.json` → `labels`, and the project template lives in `<storiesDir>/templates/`.

## Levels

| Level | What it is |
|---|---|
| Activity | One step of the user's journey. Lives in `activities.json`. The backbone of the map. |
| Story | One capability a person notices. One file. |
| Criterion | One observable behaviour, checked one way. |

Stories have no priority field. The release sets the order. The first release in `stories.config.json` is the one that measures progress.

## The story file

- File: `stories/<activity folder>/<ID>-<short-title>.md`. Lowercase, no accents, hyphens.
- ID: `<ACTIVITY CODE>-NNN`, e.g. `ACC-004`. Criterion ID: `<ID>.N`, e.g. `ACC-004.1`. IDs are permanent. Never reuse or renumber them, even after discarding.
- Title: starts with a verb in the infinitive or imperative and names what the person achieves.
- Status is never written by hand. The script computes it from the criteria and the decisions.

Sections, in order (the project uses its translated headings):

1. **Story**: "As a <persona>, I want <capability>, so that <benefit>." The persona comes from `stories.config.json` → `personas`. The benefit is not a restatement of the capability.
2. **Acceptance criteria**: see below.
3. **Out of scope**: what this story does not do, with the story ID that does it if one exists. Agents add unrequested features when nothing excludes them.
4. **Verification**: the exact command that checks this story.
5. **Open questions**: must be empty before the story is built.
6. **Notes**: optional. Files to follow as patterns, context for the builder. Never restate the Definition of Done or the project conventions.

## Acceptance criteria

Each criterion is a **rule**, optionally followed by **key examples**.

```
- **ACC-004.1** When the user saves a text, the system shows the new text in the preview. [unbuilt]
  - Given the heading says "Hello", when the user changes it to "Hi" and saves, then the preview shows "Hi".
  - Given the user clears the text, when they save, then the system keeps the previous text and shows an error.
```

- The rule states what the system does. No hedging: never "should", "may", "could". Name the behaviour.
- Add examples only where a rule could be read two ways. A boundary or an error case is the usual reason. An obvious rule needs no example.
- One behaviour per criterion. One "when" per example.
- Write examples declaratively ("the user saves"), not as clicks, selectors or URLs.
- Include the unhappy paths: error, empty, permission, limit. Agents skip them unless told.
- More than 6 criteria: split the story.

### Verification markers

Each criterion's rule line ends with exactly one marker (the project uses its translated markers):

| Marker | Meaning |
|---|---|
| `[test: <file> › "<test title>"]` | An automated test covers it. Counts only while the test passes. |
| `[manual YYYY-MM-DD, who]` | A person checked it by hand on that date. |
| `[unverified]` | The behaviour exists. Nobody has checked it. |
| `[unbuilt]` | The behaviour does not exist yet. |
| `[failing: reason]` | The behaviour exists and does not hold. |

A test title can also start with the criterion ID, e.g. `it("[ACC-004.1] shows the new text")`. Then the marker is `[test]` with no reference. Choose one convention per project and record it in the project's `CLAUDE.md`.

A bug is not a new story. Mark the criterion it breaks as failing.

## Fixing a bug

1. Find the criterion the bug breaks. Mark it failing, with the reason. If no criterion covers the behaviour, add one to the story it belongs to.
2. Find the root cause before changing code. Check the project's seams first: a bug where nothing errors and the old behaviour keeps showing is usually one half of a seam that did not change.
3. Write a test that reproduces the bug and watch it fail.
4. Fix the code until the test passes. Update the marker.

## Decisions

A decision is a choice that blocks stories: a provider, hosting, pricing. File: `decisions/DEC-NNN-<title>.md`. A story names it in `blocked_by`. A story blocked by an open decision cannot be built. Decisions are product calls: the human closes them.

## Discarding

Never delete a story. Set `discarded: true` and add a **Discard reason** section with the date and the reason.

## Splitting a story

First check the story against INVEST without "small". A story that delivers nothing alone is a task: merge it into a valuable slice instead.

Then split along the usual patterns: workflow steps, operations, rule or data variations, simple before complex, performance deferred, a time-boxed spike for a big unknown. Prefer the split that lets you drop or defer a piece.

Never split by layer ("API for…", "database for…", "front end of…"). A layer delivers nothing a person notices.

## Turning a request into stories

1. Find the activity. If none fits, propose a new one to the human; activities are product calls.
2. Write the story and its rules. Ask the human only what you cannot infer, all at once.
3. Add key examples where a rule is ambiguous.
4. Fill out-of-scope and verification.
5. Run `node <storiesDir>/stories.mjs --ready <ID>`.

## What the validator flags

`stories.mjs` checks structure on every run and readiness with `--ready`:

- Errors: bad or repeated IDs, file in the wrong folder, activity name that does not match `activities.json`, unknown release or persona, missing marker, unknown marker, missing test, unknown decision or `depends_on`, discarded without reason.
- Not ready: empty out-of-scope, empty verification, open questions, open blocking decision, hedged words in a rule.
- Warnings: story text not in the persona/want/benefit shape, vague words ("fast", "easy", "intuitive"…), more than 6 criteria, dependency not yet working.

Things the validator cannot see. Check them yourself when you write or edit a story:
- A generic persona ("user") where a specific one exists.
- A benefit that restates the want.
- A solution in the want: button, modal, endpoint, table. Test: would the wording change if the implementation changed?
- A horizontal slice with no observable outcome.
- The Definition of Done leaking into criteria ("tests written", "code reviewed").
- Over-specification: file names, algorithms or class structure without a stated reason.
