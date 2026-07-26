# Implementation notes — tasks 275, 268, 266

## What was measured, not guessed

`buildLayer1View` was run over this repo against itself at HEAD before any code
was written (868 pairs, 3 disk orphans, 0 git orphans, 683 ruler entries). Every
number quoted in the code comments comes from that run.

Three findings changed the shape of the work:

1. **The 13 px tick-label collision skip is unreachable in Layer 1.** Task 251's
   content floor charges every gap at least `RULER_NODE_ROW_PIXELS`, and the
   smallest adjacent gap this repo renders is exactly 22 px. So the guard was
   never what produced the run of identical timestamps task 268 reports —
   merging on the displayed string is.
2. **36 % of entries repeat the label above them** (247 of 683), leaving 436
   rows after the merge. Task 268 is real even after task 276 added seconds and
   hundredths, because commit instants are second-precision while disk mtimes
   are millisecond-precision.
3. **Task 266 was never a matching bug.** `AXIS_MATCH_EPSILON_PX` resolves 681
   of 683 rows. It is a landing bug, below.

## Task 266 — the mechanism actually confirmed

Two independent defects, both fixed.

### The scroll aimed at the wrong element and then forced a vertical move

`.filebox`'s border-box top is `margin-top: calc(var(--axis-px) * 1px)` — the
bubble's FIRST instant. `makeRulerTickClickable` handed that bubble to
`scrollIntoView({ block: "start" })`.

* 376 of 683 rows resolve through stage 1 (a bubble BEGINS at the clicked
  instant), where the bubble's top IS the clicked row, so the aim was right.
* 305 resolve through stage 2 (a bubble merely HOLDS a node there). There the
  bubble's top is a median **1 870 px** above the clicked row and up to
  **15 205 px**; for 212 of the 305 that is more than a pane height, so the
  timestamp the reader clicked left the viewport entirely.

The user's own words on the round-two report — "clicking the ruler row scrolls
that ruler row out of view" — are that number.

Fix, in two parts:

* stage 2 returns the ROW ELEMENT it matched instead of the bubble containing
  it, so the target is the thing actually drawn at the clicked instant;
* `block: "start"` becomes `block: "nearest"`. A ruler tick is not the find
  box's problem: the row being clicked is by definition already on screen, so
  any forced vertical alignment moves it somewhere the reader did not ask for.
  `nearest` scrolls vertically only if the target is out of view.
  `inline: "center"` is what performs the jump — the stage is ~168 000 px wide.

The user's settled rule is untouched: a bubble that BEGINS at the instant still
wins over one merely holding a node there.

### Two rows answered a click with nothing at all

An orphan bucket renders a `ul`/`li` list and no `.node`, so stage 2 was blind
to every bucket row except the earliest — which stage 1 only catches because it
is the bucket's own `--axis-px`. `buildOrphanBucket` now puts the same
widget-relative `--axis-px` on each `li` that a `.node` carries, and the lookup
selector reads `.node, li`. No CSS rule reads `--axis-px` on an `li`, so nothing
moves; it is pure data.

## Task 275 — where the count comes from

`layOutNodeLadders` already flattens every ladder, so the tally is one reuse of
`countNodesPerInstant` (renamed from `countLadderNodesPerInstant`, since it is
now asked about both one ladder and all of them flattened). `resolveInstantOffsets`
passes the same tally over its own input, so the layered graph's axis stays a
single code path rather than gaining a second counting rule.

`countRowsPerInstant`'s number is deliberately NOT reused: it takes a per-ladder
MAX because bubbles stack side by side. Over the fixture in
`tests/viewer_api_layer1_placement.test.ts` the two numbers differ (the first
commit counts 2 events but demands 1 row), and
`test_layOutNodeLadders_counts_every_node_at_an_instant_across_all_bubbles`
pins that difference explicitly.

The count rides a NEW `WireRulerTick` / `Layer1WireRulerTick` rather than a
widened `WireInstant`, because every commit, orphan and on-disk node is a
`WireInstant` too and none of them has a count.

## Task 268 — where the merge happens

On the page, in the new `webapp/layer1-ruler-rows.ts`, because the merge is on
the DISPLAYED STRING and the label format lives there. `renderLeaderLines` is
untouched: every ruler ENTRY keeps its dashed line, because bubbles still sit on
the entries whose label was folded away.

A merged row absorbs the folded entries' counts. A row that reported only its
own would under-report the moment it now stands for — the two features would
have quietly broken each other.

## Decisions worth knowing about

* **`readEventCount` throws** rather than defaulting. The count is produced by
  the same layout that produces the offsets, so a missing one is a producer bug;
  the alternative was printing `(undefined)` and, after one merge, `(NaN)`. Same
  rule `placeOrphanOnAxis` and `placeInstantOnAxis` already follow. This is why
  every ruler fixture in the test suite had to gain a real count.
* **The pixel-collision guard was kept** even though it is currently
  unreachable, and it folds its entry's count in the same way. Deleting it was
  tempting; it is three lines and it is the only thing standing between a
  lowered content floor and overprinted labels.
* **`layer1-page.ts` shrank from 238 to 220 lines** by moving
  `formatInstantLabel` and `TICK_LABEL_MIN_GAP_PX` out with the merge logic,
  which is also why `buildOrphanBucket` still calls the same helper.

## Left for someone else

* **Gutter width** — the widest row this repo renders is
  `07-24 19:31:28.00 (160)`, 23 characters. Owned by the parent session.
* **The `.leaders` comment is stale.** Task 265's comment claims a node's
  absolute canvas y equals its `axisPx`. It does not: `.filebox` adds a 2 px
  border and 68 px of padding, so a node sits ~70 px BELOW its own leader line.
  Not touched — the CSS belongs to another agent and no task in hand names it.
  Worth a task if the leader lines are meant to land on the dots.
