# Implementation notes — tasks 281 + 270 (2026-07-26)

## What changed

- `webapp/layer1.html` — `.filenav-search` row (input `#filenav-search` + clear button
  `#filenav-search-clear`) inside `<aside class="filenav">`, between the title and `#filenav-tree`.
- `webapp/layer1-styles.css` — new `.filenav-search` rules; `.fname` wraps to two clamped lines;
  `.fname:hover` restores `nowrap` and lifts the clamp; `.sub` `top: 24px -> 43px`; `.filebox`
  `padding-top: 50px -> 68px` with its derivation comment redone.
- `webapp/layer1-filenav.ts` — `renderFileNavInto` gained an optional `query`;
  `renderLayer1FileNav` wires the box and the clear button. 75 -> 105 lines.
- `tests/layer1-filenav-search.test.ts` — new; two tests.

`npx tsc --noEmit` is clean. Tests were NOT run (the user runs them).

## Decisions

**Filter before `buildFileTree`, not after.** Hiding rendered rows would leave folder rows whose
counts and single-child collapse no longer describe what is shown. The consequence is documented in
both the module and the plan: `buildFileTree` re-derives the common prefix from the survivors, so a
query that lands inside one directory can legitimately render a FLAT list with no folder row. That
is correct output, not a dropped folder.

**`oninput =` rather than `addEventListener`.** `renderLayer1FileNav` runs again on every Load, and
an accumulated listener would hold the previous load's `view` and redraw the tree from it.

**The query survives a reload.** The initial render reads `box.value` instead of assuming empty: a
pane still showing filter text but silently listing everything would be lying.

**The search never calls `onFolderSelect`.** It is purely visual, so task 253's folder filter and
the stage are untouched by typing. TRADEOFF, deliberately not solved: re-rendering the tree resets
the folders' expanded state and clears the tree's own selection highlight. Every folder is
`<details open>` by default, so the visible cost is small; tracking per-folder state across a
re-render for a pane that has no closed folders at rest was not worth the code.

**Two wrapped lines, not a wider bubble (task 270).** `min-width` is multiplied by ~800 bubbles on
a real project against a canvas that already renders ~156,000 px wide, so widening is the expensive
mechanism. Two 16 px lines at 168 px hold ~40 characters, which covers the `971e94bac3cb2811…`
names in the user's screenshot. `max-width` stays — removing it reinstates task 245.
`overflow-wrap: anywhere` is not optional: a basename has no spaces, so `white-space: normal` alone
would leave it one unbreakable word.

**The padding derivation was redone, not nudged.** `.fname` 7..39 (two explicit 16 px lines),
`.sub` 43..58, first node's ring reaches 10 px above the lane -> `padding-top: 68px`. The comment
on `.filebox` carries the arithmetic so the next person can redo it again.

## Findings for whoever owns the bubble/leader geometry

While redoing the padding derivation I traced the leader lines and believe the comment at the
`.leaders` rule ("a node's absolute canvas y is exactly `axisPx`") is arithmetically wrong, and was
already wrong before this change:

- `.filebox` sits at `margin-top: startPx` inside `.stage`, which starts at `.canvas`'s top.
- A node is placed at `axisPx - startPx` inside `.lane`, and `.lane` begins AFTER the bubble's 2 px
  border and its `padding-top`.
- So a node's absolute canvas y is `axisPx + 2 + padding-top`, while `.leader` is placed at
  `axisPx` — i.e. the dashes sit one bubble header ABOVE the nodes they are meant to touch.

This change moves that constant from 52 px to 70 px. It is uniform across every bubble, so
bubble-to-bubble alignment is unaffected, and nothing here made a correct alignment incorrect — but
if the user reports that the dashed lines miss the dots, this is the arithmetic to fix, and the fix
belongs in whichever file owns the leader placement, not in this pair of tasks.

## Not done

`npm run build:webapp` was NOT run: two other agents are editing `webapp/*.ts` concurrently and a
build would compile their in-flight files too. The page needs that build plus a HARD reload before
the search box does anything.
