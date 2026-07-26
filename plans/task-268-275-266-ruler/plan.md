# Plan — tasks 275, 268, 266 (Layer 1 ruler rows)

One plan for three tasks because all three change what a ruler ROW is: what it
counts (275), when two entries collapse into one (268), and where clicking one
lands (266).

## Measured ground truth

Every number below comes from running `buildLayer1View` over this repo against
itself at HEAD (868 pairs, 0 git orphans, 3 disk orphans, 683 ruler entries):

| measurement | value |
| --- | --- |
| smallest gap between adjacent ruler entries | 22 px |
| entries whose label repeats the entry above it | 247 of 683 (36 %) |
| rows left after merging equal labels | 436 |
| largest event count at one instant | 160 |
| widest merged row text | `07-24 19:31:28.00 (160)` — 23 characters |
| entries a bubble BEGINS at (click stage 1) | 376 |
| entries answered by click stage 2 | 305 |
| stage-2 landing error (clicked row → bubble top) | median 1 870 px, max 15 205 px |
| stage-2 errors larger than one pane height (800 px) | 212 of 305 |
| entries no bubble answers at all | 2 (both disk-orphan-only instants) |

Two consequences the tasks were written before anyone could see:

1. The 13 px label-collision skip in `renderRulerTicks` is **unreachable** in
   Layer 1. Task 251's content floor gives every adjacent pair at least
   `RULER_NODE_ROW_PIXELS` (22 px). So merging on the DISPLAYED STRING is the
   only thing that reduces the gutter, exactly as task 268 asks.
2. Task 266 is not a matching bug. `AXIS_MATCH_EPSILON_PX` resolves 681 of 683
   rows. It is a **landing** bug, described below.

## Task 275 — the event count

`layOutNodeLadders` already flattens every ladder; the count is the number of
NODES at an instant across all of them, which is what "how many events occurred
at that timestamp" means. `countRowsPerInstant`'s number is deliberately NOT
reused — it takes a per-ladder MAX (bubbles stack side by side), which is the
ruler's spacing demand, not a tally.

* `webapp/layer1-ruler-axis.ts` — rename `countLadderNodesPerInstant` to
  `countNodesPerInstant` (it is now also asked about the flattened set), add
  `eventCount` to `RulerPosition`, and pass the tally into `accumulateOffsets`.
  Both entry points supply one, so the layered graph's axis
  (`resolveInstantOffsets`) stays a single code path.
* `webapp/layer1-wire.ts` / `src/viewer_api_layer1.ts` — a new
  `WireRulerTick` / `Layer1WireRulerTick` extending the instant type, rather
  than widening `WireInstant`, which every commit and orphan node also uses.
* `src/viewer_api_layer1.ts` and `webapp/layer1-filter.ts` — both `ruler`
  emitters carry the count through, so a folder filter's ruler agrees with the
  shipped one.

## Task 268 — merging rows that read the same

The merge is on the DISPLAYED STRING, per the user's phrasing, and therefore
belongs on the page side of the wire — the label format lives there.

New module `webapp/layer1-ruler-rows.ts` owns `TICK_LABEL_MIN_GAP_PX`,
`formatInstantLabel` (moved out of `layer1-page.ts`, which is at 237 of 250
lines) and `listRulerRows`, which folds an entry into the row above it when

* its label repeats that row's label, or
* it would physically overprint it (the existing, now-unreachable guard).

Either way the surviving row ABSORBS the folded entry's `eventCount`, or the
`(n)` under-reports the moment the row stands for.

`renderLeaderLines` is untouched: every ruler ENTRY keeps its dashed line
because bubbles still sit on the entries whose label was folded away.

## Task 266 — clicking a row lands on the wrong place

Mechanism, confirmed against the real render rather than the fixture:

`.filebox`'s border-box top is `margin-top: calc(var(--axis-px) * 1px)`, i.e.
the bubble's FIRST instant. `makeRulerTickClickable` scrolls the found BUBBLE
with `block: "start"` (task 277), which aligns that first instant with the top
of the pane.

* Stage 1 (a bubble BEGINS at the clicked instant) — correct by construction,
  376 of 683 rows.
* Stage 2 (a bubble merely HOLDS a node there) — the bubble's first instant is
  a median 1 870 px above the clicked row, and for 212 of the 305 stage-2 rows
  it is more than a pane height away, so the timestamp the reader clicked ends
  up off-screen entirely. That is "clicking a ruler row does not jump to the
  first bubble with that timestamp".
* 2 rows resolve to nothing: an orphan bucket renders a `ul`/`li` list and no
  `.node`, so stage 2 is blind to every bucket row except the earliest (which
  stage 1 catches as the bucket's own `--axis-px`).

Fix, keeping the user's settled rule (a bubble that BEGINS there wins,
otherwise a bubble merely holding a node there):

* `webapp/layer1-ruler-click.ts` — stage 2 returns the matched ROW ELEMENT
  instead of its bubble. `block: "start"` then aligns the clicked instant, and
  `inline: "center"` still brings the containing bubble into view.
* `webapp/layer1-page.ts` — `buildOrphanBucket` puts the same widget-relative
  `--axis-px` on each `li` that a `.node` carries, and stage 2's selector reads
  `.node, li`, so a bucket-only instant stops being a dead row. No CSS reads
  `--axis-px` on an `li`, so this is inert data.

## Checks left behind

* `tests/layer1-ruler-axis.test.ts` — `eventCount` totals across ladders, and
  that it is NOT the per-ladder max the spacing floor uses.
* `tests/layer1-ruler-rows.test.ts` (new) — same-label entries merge and their
  counts SUM; different labels do not merge.
* `tests/layer1-ruler-click.test.ts` — stage 2 hands `scrollIntoView` the row
  at the clicked instant, not the bubble's top; a bucket-only row is clickable.

## Out of scope, reported not fixed

* `webapp/layer1-styles.css` `--rail-x` / `.ruler .tick` width must grow for a
  23-character label (owned by the parent session).
* The task-265 comment on `.leaders` claims a node's absolute canvas y equals
  its `axisPx`. It does not: `.filebox` adds a 2 px border and 68 px of
  padding, so a node sits 70 px BELOW its own leader line. Not touched — the
  CSS is another agent's and the tasks in hand do not name it.
