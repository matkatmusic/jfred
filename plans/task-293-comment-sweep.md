# Task 293 — comment sweep (hook-driven verbose-comment truncation)

## Context
The `comment-sweep` worktree's source carries many multi-line `//` comment blocks
that are verbose, redundant, or outdated. They bloat the context of any agent
reading the code. The goal is to collapse every over-long prose comment into a
single concise line (≤20 words) while leaving accurate, necessary comments alone.

A `PostToolUse:Edit` hook ("Reflowing wrapped comments") is the **authority** on
what needs fixing. We drive the sweep off the hook, not off human judgment.

## How the hook works (verified empirically on `webapp/layer1-zoom.ts`)
1. Any Edit/Write to a file fires the hook. It **auto-concatenates** eligible
   multi-line plain-prose `//` blocks into one line by itself.
2. It then returns a **blocking** report listing the file and the concatenated
   line numbers that still exceed **20 words**, with the instruction: *"Rewrite
   each comment below to under 20 words, keeping it on one line."* and a
   `nl -ba <file> | sed -n 'Xp;Yp'` command to display them.
3. It does **not** flag: file/symbol comments already ≤20 words, `ponytail:`
   blocks, or comments containing backtick code spans. Whatever it doesn't flag
   is, by definition, done.
4. The hook fires for subagents too — a subagent editing the file gets the same
   live feedback and can self-correct until the report is empty.

## Decisions locked with the user
- **Work list:** all git-tracked files except `src/regex_expressions.ts`;
  blank-line-trip each one-by-one so the hook fires; dispatch a subagent only
  for files the hook actually flags. Sweep is done when no file flags remaining
  fixes. Pre-existing worktree modifications are prior comment-script output
  and need no separate baseline commit.
- **Dispatch mechanism:** the **Workflow tool** — each file runs as
  `agent(brief, {model: 'claude-opus-4-6[1m]', effort: 'low'})`.
- **Protected-comment deadlock:** protection wins. If the hook flags a
  regex-explaining or invariant/workaround comment >20 words, the subagent
  leaves it verbatim, finishes with a non-empty report, and the orchestrator
  logs those lines as accepted residue.
- **Timeout:** if a subagent's 10 min elapse with lines still flagged, re-queue
  the file in a later batch with a fresh subagent; don't block the pipeline.
- **Hard exclusion:** never touch `src/regex_expressions.ts` — its comments
  document the regex library and must stay verbatim.

## Structure: batches of 4, waves of 20
- **Batch = 4 files** → 4 subagents in parallel (one file each). Unit of dispatch.
- **Wave = 20 files** = 5 batches. Unit of **orchestrator verification** (below).

## Execution loop
1. **Trip files.** Append a single trailing blank line to each (parallel Edit
   calls). Capture each file's hook report — the flagged line numbers.
   - Files that return no flags need no subagent; skip them, keep tripping.
2. **Dispatch 4 subagents in parallel** (one file each, Opus 4.6 with effort=low, 10-min budget)
   with the brief below and that file's flagged line numbers.
3. Re-queue any still-flagged / timed-out files into a later batch.
4. **After every wave of 20 files, the orchestrator runs verification** (below)
   before starting the next wave.
5. Repeat until every tracked file trips clean or the 1-hour budget is spent.

## Subagent brief (per file) — the rule, given verbatim to every subagent
Scope: **only** the named file. The reflow hook flagged these lines as over 20
words: `<line numbers>`. Apply this rule:
1. **Delete** any comment that restates what the next line already says
   (`// increment i`), that is stale/wrong, that is a section banner
   (`// ---- helpers ----`), or that is a JSDoc block whose tags only repeat the
   TypeScript signature (`@param path {Path}`).
2. **Keep at most one comment per block**, rewritten as a single sentence
   **under 20 words** stating *why* the code exists, not *what* it does.
3. **Never delete**: `ponytail:`, `TODO`, `FIXME`, `HACK`, `@ts-`, `eslint-`,
   `#!` shebangs, license headers, or a comment recording a non-obvious
   invariant / bug workaround (keep and shorten, don't cut).
4. **Change zero code.** No renames, reordering, code-line formatting, or import
   changes. Comment lines only.
5. Do not delete `//` inside string literals or URLs.
6. **Never delete or shorten a comment that explains a regular expression** — any
   comment next to a `RegExp` / `/.../` literal stays verbatim.
Your own edits re-trigger the hook; iterate until its report is empty **or**
every remaining flagged line is protected by rule 3 or 6 — then stop and list
those line numbers as accepted residue in your final report. Do not run
tests or typecheck. You have 10 minutes to complete your file. 

## Coverage / time note
Throughput is ~4 files per ≤10-min batch. If the tracked-file set flags more
files than fit in one hour, prioritize the highest-density files first (per the
prior inventory: `tests/timeline-filter-model.test.ts`, `webapp/views/timeline-types.ts`,
etc.) and report the un-swept remainder at the deadline rather than overrunning.

## Verification — orchestrator, after every wave of 20
1. **No real code changed** — the diff must contain only comment lines:
   ```sh
   cd .claude/worktrees/comment-sweep
   git diff -U0 -- <wave files> | rg '^[+-]' | rg -v '^(\+\+\+|---)' | rg -v '^[+-]\s*(//|/\*|\*)' | rg -v '^[+-]\s*$'
   ```
   Must print nothing. Blank/whitespace-only lines (the trip lines) are exempt
   via the final filter — trip lines stay in place, no cleanup pass.
   Any other output means an agent touched real code → revert that file.
2. **Typecheck once per wave:** `npx tsc --noEmit`.
3. Per file, a final blank-line trip returns an **empty** hook report.

At the very end of the sweep: `npm run build:webapp`, `npm run visual`. The user
runs the test suite. `src/regex_expressions.ts` shows no diff.

## Already done this session
`webapp/layer1-zoom.ts` has been tripped; hook flagged lines **14, 40**. It is
the first file ready for a subagent.
