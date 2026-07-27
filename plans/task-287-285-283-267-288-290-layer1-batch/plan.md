# Plan — Layer 1 View batch: tasks 287, 285, 283+267, 288, 290

All six tasks touch `webapp/layer1-styles.css`, so they are implemented **serially in one
session**, in the order below. Repo root for every path here:
`/Users/matkatmusicllc/Desktop/claude code src/RevEng/jfred`.

Do **not** run any test suite — the user runs tests after the work lands.

User clarifications received 2026-07-26 while planning (they override the task text):

- **287** — the revealed name's new colour must read **orange in dark mode**.
- **285** — the find widget goes **to the RIGHT of the `No on-disk match` button**.
- **283** — the highlight must **stay lit** instead of fading after ~1.5 s, and **only one
  element may be highlighted at a time**.
- **267** — a highlighted NODE is marked with **`[ ]` brackets** in the same colour as the
  highlighted bubble: left and right sides plus the four corners only, NOT a full rounded ring.
- **288** — if the dashed leader lines are the latency source, defer drawing them to `pointerup`.
  Step 5's fix makes that unnecessary and the plan says why, in Step 5's preamble.

---

## Step 1 — Task 287: the hover-revealed full file name gets its own colour

No test. happy-dom implements no layout and no cascade resolution for a `:hover` state, so a
test here would assert the literal text of a CSS declaration — a copy of the diff, not a
behaviour. Same reasoning already recorded at the top of `tests/layer1-filenav-resize.test.ts`.

1. In `webapp/layer1-styles.css`, in the `.filebox .fname:hover` rule (currently one rule
   spanning two lines, immediately after `.filebox .fname`), add **one declaration**:
   `color: var(--c-user);`
2. Use `var(--c-user)` and no other token. It is the orange the user asked for, it is defined
   in all three token blocks (`.viz-root`, the `prefers-color-scheme: dark` block and the
   `[data-theme="dark"]` block — `#eb6834` light, `#d95926` dark), and no `.node` class on this
   page paints with it (`.n-commit` uses `--c-commit`, `.n-disk` uses `--c-disk`), so the
   revealed name cannot be confused with a node type.
3. Change nothing else in that rule: `max-width`, `overflow`, `z-index`, `background`,
   `border-radius`, `padding` and `margin-left` are the reveal geometry and are already correct.
4. Append to that rule's existing comment block: task 287 — the revealed path used to inherit
   `.filebox .fname`'s `--c-snap`, the colour EVERY bubble's name uses, so a revealed long path
   read as one continuous run of green monospace mixed with the names of the bubbles it was
   painted over; `--c-user` is unused elsewhere on this page and is defined in every theme block.

---

## Step 2 — Task 290: leader lines and ruler ticks move down onto the nodes

Confirmed by derivation over the CSS before changing anything (task 290 asks for this):

- `.filebox` has `margin-top: calc(var(--axis-px) * 1px)` and its own comment states the
  intent — "it keeps the border-box top edge at --axis-px". `.filebox` is a flex item of
  `.stage`, which is a flex item of `.canvas` with no margin, so the bubble's border-box top is
  `canvasTop + axisPx`.
- `.lane` is the first in-flow child, so it starts after `.filebox`'s `2px` border and its
  `50px` `padding-top` → `canvasTop + axisPx + 52`.
- A `.node` is `top: calc(var(--axis-px) * 1px)` inside `.lane` with `translateY(-50%)`, and
  its widget-relative offset is `nodePx - startPx`, so its centre is
  `canvasTop + startPx + 52 + (nodePx - startPx)` = **`canvasTop + nodePx + 52`**.
- `.leaders` is `position: absolute; inset: 0` against `.canvas` and `.leader` is
  `top: calc(var(--axis-px) * 1px)` → `canvasTop + axisPx`. `.ruler` is also a flex item of
  `.canvas` with no margin and `.ruler .tick` is `top: calc(var(--axis-px) * 1px)` with
  `translateY(-50%)` → also `canvasTop + axisPx`.

So both are exactly **52 px above** the dots they mark, and the offset is `2 + 50`.

No test. This is pure CSS geometry and happy-dom has no layout; the existing
`tests/layer1-page-leaders.test.ts` asserts the inline `--axis-px` values, which this step does
not touch, so it must keep passing unchanged.

1. In `webapp/layer1-styles.css`, add the offset as a custom property on the `.canvas` rule
   (the rule that already declares `position: relative; min-width: max-content; display: flex;
   zoom: var(--zoom, 1); isolation: isolate; gap: 14px`):
   `--lane-y: 52px;`
   `.canvas` is chosen because it is the nearest common ancestor of BOTH consumers — `.leader`
   (inside `.leaders`, inside `.canvas`) and `.ruler .tick` (inside `.ruler`, inside `.canvas`)
   — so one declaration reaches both and neither can be moved without the other.
2. Comment the new property with its DERIVATION, not its value: it is `.filebox`'s `2px` border
   plus its `50px` `padding-top`, i.e. the distance from a bubble's border-box top (which is
   `--axis-px`) down to `.lane`'s top, where the `--axis-px: 0` node sits. State that changing
   `.fname`/`.sub`'s `top` or font sizes changes `.filebox`'s derived `padding-top` and
   therefore this number too (task 270 briefly made it 70 px).
3. Change `.ruler .tick`'s `top` to `calc(var(--axis-px) * 1px + var(--lane-y))`.
4. Change `.leader`'s `top` to `calc(var(--axis-px) * 1px + var(--lane-y))`.
   Both are changed together in this one step: moving only one would make the gutter disagree
   with the dashed lines, which is worse than the bug being fixed.
5. Fix the WRONG paragraph in the `.leaders` comment block. The sentence "a node is placed at
   `axisPx - startPx` inside a bubble whose own offset is `startPx`, so its absolute canvas y is
   exactly `axisPx`" omits the border and the header padding, so task 265 did not achieve what it
   documents. Replace that claim with the corrected derivation from the top of this step and name
   `--lane-y` as what closes the gap.
6. Do NOT touch `.nlabel`, `.lane .tiegroup` or `.lane .lrail`: they are inside `.lane`, so they
   already share the nodes' frame of reference and are already aligned.
7. Do NOT touch the inline `--axis-px` values any renderer writes. `layer1-ruler-click.ts` reads
   a tick's instant back out of `--axis-px` (`readAxisPx`), not out of `top`, so the click lookup
   is unaffected by this step — verify by reading, and change nothing in that module here.

### Step 2b — Task 290, second half: hovering a leader line reveals what it points at

User, 2026-07-26: "I cannot visually tell what the dashed leader lines are actually pointing at
when they intersect with a bubble or node. Idea: when you mouse over a leader line and the node(s)
or bubble(s) it is pointing to is/are in the visible part of the timeline, highlight those nodes and
make the dashed leader line's color change to the same highlight color used for nodes and bubbles."

This is a HOVER state over MANY elements, so it must not reuse `.found` — that class is the single
persistent selection from Step 3. Use a second class, `aimed`, added on pointer-enter and removed on
pointer-leave. Implement this step AFTER Step 3, so the lookup it shares already exists.

1. `webapp/layer1-ruler-click.ts` — replace `findBubbleBeginningAt` and `findRowHoldingAxisPx` with
   ONE exported collector, and re-express `findScrollTargetForAxisPx` on top of it. This is a net
   simplification (two walks become one) and must preserve both stages exactly: bubbles that begin
   at the instant come first in document order, then the rows holding it, so `find`-ing the
   `.filebox` is stage 1 and falling back to the first element is stage 2.

```ts
// Everything DRAWN at one instant, in document order: a bubble whose own `--axis-px` is that
// instant (it begins there) comes before the rows inside it, and a bubble that merely holds the
// instant contributes only its matching rows. Both the click's two-stage pick and the leader
// hover's "highlight every target" read this one walk, so they cannot disagree about what is at an
// instant.
export function listElementsDrawnAtAxisPx(axisPx: number): HTMLElement[] {
    return listBubbles().flatMap((bubble) => {
        const bubblePx = readAxisPx(bubble);
        const held = [...bubble.querySelectorAll<HTMLElement>(BUBBLE_ROW_SELECTOR)]
            .filter((row) => axisMatches(bubblePx + readAxisPx(row), axisPx));
        return axisMatches(bubblePx, axisPx) ? [bubble, ...held] : held;
    });
}

export function findScrollTargetForAxisPx(axisPx: number): HTMLElement | undefined {
    const drawn = listElementsDrawnAtAxisPx(axisPx);
    return drawn.find((element) => element.classList.contains("filebox")) ?? drawn[0];
}
```
   Keep `readAxisPx` but EXPORT it, since the hover module reads a leader's own offset with it.
   Rewrite the two stage comments into one describing the collector; the observable rule they
   document (bubble-that-begins wins, else the row itself — task 266) is unchanged, and the five
   existing tests in `tests/layer1-ruler-click.test.ts` are the proof of that.

2. New module `webapp/layer1-leader-hover.ts` — its own file because `layer1-page.ts` is at 220 of
   the repo's 250-line cap and this is a second behaviour, not a variation on the tick click:

```ts
import { getRequiredElementById } from "./app-dom.ts";
import { listElementsDrawnAtAxisPx, readAxisPx } from "./layer1-ruler-click.ts";

// The class the CSS paints the "this line points HERE" state from. Deliberately NOT `.found`: that
// is Step 3's single persistent selection, and this is a transient set of several elements.
const AIMED_CLASS = "aimed";

// What the pointer is currently over, so leaving can darken exactly what entering lit.
let aimedElements: HTMLElement[] = [];

function clearAimedElements(): void {
    for (const element of aimedElements) {
        element.classList.remove(AIMED_CLASS);
    }
    aimedElements = [];
}

// Whether an element overlaps the timeline pane's scrollport AT ALL, which is the user's condition
// ("...is/are in the visible part of the timeline"). The pane, not the window: `main.timelines` is
// the scroll container, so anything outside its box has been scrolled away even though it is still
// in the document. Rect-vs-rect, so it is correct under the native `zoom` on `.canvas` — both rects
// are post-layout.
function isInsideVisibleTimeline(element: HTMLElement): boolean {
    const pane = getRequiredElementById("timelines").getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return box.right > pane.left && box.left < pane.right
        && box.bottom > pane.top && box.top < pane.bottom;
}

// Light the line and everything it points at, or nothing at all: the user asked for the recolour
// only when a target is actually on screen, so a line whose bubbles are all scrolled away stays
// grey rather than promising a target the reader cannot find.
function aimLeaderAtVisibleTargets(leader: HTMLElement): void {
    clearAimedElements();
    const visible = listElementsDrawnAtAxisPx(readAxisPx(leader)).filter(isInsideVisibleTimeline);
    if (visible.length === 0) {
        return;
    }
    aimedElements = [leader, ...visible];
    for (const element of aimedElements) {
        element.classList.add(AIMED_CLASS);
    }
}

// Wire one already-positioned leader and hand it back, exactly as makeRulerTickClickable does, so
// layer1-page.ts's renderLeaderLines stays a single expression. `pointerenter`/`pointerleave` and
// not `pointerover`/`pointerout`: a leader has no children, and the enter/leave pair does not fire
// again as the pointer travels along the same line.
export function makeLeaderHoverable(leader: HTMLElement): HTMLElement {
    leader.addEventListener("pointerenter", () => aimLeaderAtVisibleTargets(leader));
    leader.addEventListener("pointerleave", clearAimedElements);
    return leader;
}
```

3. `webapp/layer1-page.ts` — import `makeLeaderHoverable` and wrap the one existing expression in
   `renderLeaderLines` (line ~59): `makeLeaderHoverable(setAxisPx(el("div", { class: "leader" }), entry.axisPx))`.
   Nothing else in that file changes.

4. `webapp/layer1-styles.css` — three changes around `.leaders`/`.leader`:
   - `.leaders` KEEPS `pointer-events: none` (it is a full-canvas overlay and must never swallow a
     click); put `pointer-events: auto` on `.leader` alone.
   - give `.leader` `height: 8px` so there is something to hover. The visual line is the
     `border-top`, which stays exactly on the element's top edge, so the box grows DOWNWARD only
     and nothing moves; without this the hit target is the 1px border and the feature is
     unusable in practice.
   - add `.leader.aimed { border-top-color: var(--sel-edge); }` and fold the aimed state into the
     node/bubble marks so the hover speaks the same language as the click:
     `.filebox.aimed { outline: 3px solid var(--sel-edge); outline-offset: 3px; }` and let the node
     brackets and the bucket-row ring match on `.aimed` as well as `.found` by extending those
     selectors (`.node.found::before, .node.aimed::before`, etc.).
   Comment WHY the hit box is 8px tall and why the class is `aimed` rather than `found`.

5. Test — add `tests/layer1-leader-hover.test.ts`. happy-dom returns an all-zero rect from
   `getBoundingClientRect`, so `isInsideVisibleTimeline` answers false for everything and the
   feature cannot be observed without a stub. Patch the prototype AFTER booting, exactly as
   `tests/layer1-ruler-click.test.ts` patches `scrollIntoView`, and reuse that file's fixture shape
   (`buildSharedInstantView`-style view with a known `axisPx`) via
   `tests/layer1-view-test-helpers.ts` if a suitable builder is already there:

   - `test_hovering_a_leader_line_highlights_every_visible_target_at_its_instant` — with all rects
     stubbed as an on-screen box, `pointerenter` on the leader at the shared instant leaves the
     leader and both the bubble that begins there and the node holding it carrying `aimed`.
   - `test_leaving_a_leader_line_drops_the_highlight` — `pointerleave` removes every `aimed`.
   - `test_a_leader_whose_targets_are_scrolled_away_stays_unhighlighted` — with the pane's rect
     stubbed disjoint from the targets' rect, `pointerenter` adds `aimed` to nothing, including the
     leader itself.

---

## Step 3 — Tasks 283 + 267: a clicked ruler tick highlights what it landed on

283 and 267 are the same feature (267: "visual feedback that shows you which node is the node
associated with the clicked ruler row"), so they are implemented once.

`layer1-ruler-click.ts`'s `findScrollTargetForAxisPx` already returns EITHER the `.filebox` that
begins at the instant (stage 1) OR the `.node` / bucket `li` holding it (stage 2), so the
implementation highlights **whatever that function returned** and needs no second lookup and no
new "which case fired" return value.

**Do NOT call `landOnBubble`.** Task 283's text asks for that, but it was written before task
266 landed: `landOnBubble` scrolls with `block: "start"`, and `makeRulerTickClickable`
deliberately uses `block: "nearest"` because the clicked row is by definition already on screen.
Routing the tick through `landOnBubble` would regress task 266 and break three assertions in
`tests/layer1-ruler-click.test.ts`. Share the HIGHLIGHT only.

### 3a — RED: two new tests in `tests/layer1-ruler-click.test.ts`

Add at the end of the file, reusing that file's existing helpers (`loadPageWithView`,
`buildSharedInstantView`, `clickRulerTickAt`, `readBubbleName`, `readAxisPx`). `recordScrollRequests`
is NOT needed by these two — they read the DOM, not the scroll spy.

```ts
// The one element currently carrying the highlight class, or undefined. The class is what
// layer1-styles.css draws the outline from, so it IS the contract — happy-dom has no layout, so
// a measured outline would be measuring happy-dom (same reasoning as the header of this file).
function findHighlightedElement(): HTMLElement | undefined {
    return document.querySelector<HTMLElement>(".found") ?? undefined;
}

test("test_clicking_a_ruler_tick_highlights_the_bubble_that_begins_there", async () => {
    // Scenario (tasks 283/267): the tick scrolls the bubble across, but on a dense stage nothing
    // says WHICH bubble the tick meant, so the reader arrives and still has to work it out.
    // Steps:
    // draw both pairs, with nothing highlighted yet.
    await loadPageWithView(buildSharedInstantView());
    assert.equal(findHighlightedElement(), undefined);
    // click the instant beginning.ts begins at — the stage-1 case.
    clickRulerTickAt(SHARED_PX);
    // that bubble, and only it, is lit.
    const lit = findHighlightedElement();
    assert.equal(readBubbleName(lit!), "beginning.ts");
    assert.ok(lit!.classList.contains("filebox"));
});

test("test_clicking_a_ruler_tick_highlights_the_node_holding_that_instant", async () => {
    // Scenario (task 267 in the user's words): when the tick resolves through stage 2 the reader
    // needs the NODE marked, not merely its containing bubble — the bubble may be thousands of px
    // tall and begin at an entirely different instant.
    // Steps:
    // draw both pairs and click the row only spanning.ts's on-disk node stands on.
    await loadPageWithView(buildSharedInstantView());
    clickRulerTickAt(HELD_PX);
    // the lit element is the NODE at that instant, not the `.filebox` around it.
    const lit = findHighlightedElement();
    assert.ok(lit!.classList.contains("node"), `lit a ${lit!.className} rather than a node`);
    assert.equal(readAxisPx(lit!.closest(".filebox") as HTMLElement) + readAxisPx(lit!), HELD_PX);
});

test("test_a_second_ruler_tick_click_moves_the_highlight_rather_than_adding_one", async () => {
    // Scenario (user, 2026-07-26): "Only one bubble can be highlighted at a time." Two clicks in
    // a row must leave exactly one lit element, and it must be the second one's target.
    // Steps:
    // draw both pairs, click one instant, then click another.
    await loadPageWithView(buildSharedInstantView());
    clickRulerTickAt(SHARED_PX);
    clickRulerTickAt(EARLY_PX);
    // exactly one element is lit, and it is the bubble the SECOND click landed on.
    assert.equal(document.querySelectorAll(".found").length, 1);
    assert.equal(readBubbleName(findHighlightedElement()!), "spanning.ts");
});
```

### 3b — GREEN: make the highlight shared, persistent and single

In `webapp/layer1-find-file.ts`:

1. **Delete** `HIGHLIGHT_MS` and its comment, `unlightTimer`, and every `clearTimeout(unlightTimer)`
   / `setTimeout(...)` call. The user asked for the highlight to stay lit, so the timer and the
   "cancel the previous timer" machinery are dead code — this step is a net deletion.
2. Rename `highlightBubble` to `highlightLandedElement` and **export** it, because it now also
   receives a `.node` and a bucket `li` and a name saying "bubble" would be a lie. Rename its
   parameter `bubble` → `landed` and the module-scope `litBubble` → `litElement` for the same
   reason. Its body becomes:

```ts
// Light the element a jump landed on, and darken whatever was lit before: exactly ONE thing on the
// page carries `.found` at any moment (user, 2026-07-26). Exported because a ruler-tick click
// (tasks 283/267) lights the same way — it lands on a `.node` or a bucket `li` rather than always a
// `.filebox`, which is why nothing here reads the element's kind.
//
// The highlight is PERSISTENT. It used to switch itself off after 1.5 s so it could not be mistaken
// for the bubble's own styling; the user's 2026-07-26 instruction is the opposite — "leave the
// bubble's highlighted effect active instead of fading out quickly" — so the timer is gone and the
// light moves only when something else is landed on, or when the find box is emptied.
export function highlightLandedElement(landed: HTMLElement): void {
    litElement?.classList.remove("found");
    litElement = landed;
    landed.classList.add("found");
}
```

3. Update the two remaining references: `landOnBubble` calls `highlightLandedElement(bubble)`,
   and `clearFindState` keeps clearing `litElement` (drop its `clearTimeout` line only).
4. Update this module's header comment where it documents the 1.5 s behaviour.

In `webapp/layer1-ruler-click.ts`:

5. Import the highlight: `import { highlightLandedElement } from "./layer1-find-file.ts";`
   (no cycle — `layer1-find-file.ts` imports only `./app-dom.ts`).
6. Rewrite the click listener body in `makeRulerTickClickable` so the SAME element is scrolled and
   lit, keeping the existing `block: "nearest", inline: "center"` and its comment intact:

```ts
        const landed = findScrollTargetForAxisPx(readAxisPx(tick));
        if (landed === undefined) {
            return;
        }
        landed.scrollIntoView({ block: "nearest", inline: "center" });
        highlightLandedElement(landed);
```
   The early return keeps the existing "a tick with no bubble at all is left inert rather than
   throwing" contract that the previous `?.` gave, without nesting the two calls in a condition.
7. Add to this module's header comment: what is LIT is the same element that is scrolled, so the
   stage-1 case marks a `.filebox` and the stage-2 case marks the `.node`/`li` actually drawn at
   the clicked instant, which is task 267's requirement.

In `webapp/layer1-styles.css`:

8. Below the existing `.filebox.found` rule, add the rules for what stage 2 lands on. A lit NODE is
   bracketed `[ ]` — the user's 2026-07-26 instruction: "the node doesn't need a full rounded
   rectangle to indicate 'selected == true', just the left and right sides, and the 4 corners".
   A `[` is a bordered box with its RIGHT border removed, so the whole mark is two 4px-wide
   pseudo-elements and no new markup:

```css
  /* Tasks 283/267: what a ruler-tick click landed on when the instant belonged to a NODE rather
     than to a bubble that begins there. Same `var(--sel-edge)` as `.filebox.found` above so the
     page speaks ONE highlight language, and — task 261's convention — nothing here is a `border`
     on the target itself, which would move the very geometry this page exists to inspect.
     The mark is `[ ]` (user, 2026-07-26): a bracket is a bordered box with one side dropped, so
     `::before` is the box minus its right border and `::after` the box minus its left. The numbers
     are DERIVED from `.node` above: a node's box is 15px and its 2.5px `--surface` ring reaches
     10px from its centre, so `right: 100%` + a 2px gap puts the bracket clear of the ring, and
     -6px/-6px makes it taller than the ring on both sides. A bucket `li` is a text row 1px from
     its neighbours, not a dot, so it keeps a plain ring — brackets sized for a 15px dot would
     print over the rows above and below it. */
  .node.found::before, .node.found::after { content: ""; position: absolute; top: -6px; bottom: -6px;
    width: 4px; border: 2px solid var(--sel-edge); }
  .node.found::before { right: 100%; margin-right: 2px; border-right: none; }
  .node.found::after { left: 100%; margin-left: 2px; border-left: none; }
  .bucket li.found { outline: 2px solid var(--sel-edge); outline-offset: 1px; border-radius: 3px; }
```

---

## Step 4 — Task 285: the find widget moves onto the jump bar

The user asked for it "to the right of the 'No on-disk match' button", so it becomes the LAST
group in `.jumpbar`.

Move the **whole widget**, not just the `<label>` the task text names: the `<label>Find bubble …`,
`#find-prev`, `#find-next` and `<span class="find-status" id="find-status">`. Splitting an input
from its own cycle buttons and its own readout across two rows is worse than the layout being
fixed. `wireFindFileBox` resolves all four by id, so no JS change is needed — confirm by reading
`webapp/layer1-find-file.ts`'s `wireFindFileBox` before editing, not after.

### 4a — RED: one new test

Add to `tests/layer1-find-file.test.ts` (it already boots the live `webapp/layer1.html` body via
`setupLayer1Dom`, so the element's real position is observable there):

```ts
test("test_the_find_widget_sits_at_the_end_of_the_jump_bar", async () => {
    // Scenario (task 285, user 2026-07-26): the find box was buried among the source paths while
    // the bucket jump buttons sat in the header, so the page's two navigation controls were in two
    // unrelated places. Requested position: to the RIGHT of the last `Jump to:` button.
    // Steps:
    // boot the page.
    <use whatever this file's existing boot helper is>
    // the box, its two cycle buttons and its readout all live inside the jump bar.
    const jumpbar = document.querySelector(".jumpbar")!;
    for (const id of ["find-file", "find-prev", "find-next", "find-status"]) {
        assert.ok(jumpbar.contains(document.getElementById(id)), `${id} is not in the jump bar`);
    }
    // and the widget follows the bucket buttons rather than preceding them.
    const children = [...jumpbar.children];
    const lastBucketButton = [...jumpbar.querySelectorAll("[data-bucket]")].at(-1)!;
    const findLabel = document.getElementById("find-file")!.closest("label")!;
    assert.ok(children.indexOf(findLabel) > children.indexOf(lastBucketButton));
});
```

Read that file's own setup helper first and use it verbatim rather than inventing a second one.

### 4b — GREEN: `webapp/layer1.html`

1. Cut the four elements (the `Find bubble` `<label>` and its `<input id="find-file">`, the
   `#find-prev` and `#find-next` buttons, the `#find-status` span) **together with their two
   explanatory comments (tasks 271 and 273)** out of the `.sources` div.
2. Paste them into the `.jumpbar` div, AFTER the `data-bucket="No on-disk match"` button.
3. Leave the three source-path labels and the `#load` button in `.sources` in their current order;
   `.sources` is `display: flex; flex-wrap: wrap` with no positional selectors, so `#load` needs
   no change once the trailing label leaves.
4. Update the `.jumpbar` comment in the html to say the row now carries the find widget too, and
   why (both are navigation controls).

### 4c — GREEN: `webapp/layer1-styles.css`

The widget's styling is `.sources`-scoped and would silently stop applying. Retarget:

1. `.sources label` → `.sources label, .jumpbar label` (the moved label keeps its inline-flex,
   11.5px, `--muted` treatment).
2. `.sources input` → `.sources input, .jumpbar input` and `.sources input:focus` →
   `.sources input:focus, .jumpbar input:focus` (the find box keeps the monospace/border/focus
   treatment it shares with the source paths — the page has three text inputs and three visual
   treatments would read as three unrelated widgets).
3. `.sources .find-status` → `.jumpbar .find-status`. Keep the `min-width: 0` + `overflow: hidden`
   + ellipsis + `nowrap` declarations exactly as they are: `.jumpbar` is a `flex-basis: 100%` row,
   so with the default `flex-shrink: 1` those are what make a long matched path ellipsise instead
   of overflowing the header.
4. **DELETE** both `.sources #find-prev, .sources #find-next { padding: 3px 8px; margin-left: -8px; }`
   and `.sources #find-prev { margin-left: 0; }`. `.jumpbar button { padding: 3px 8px; }` already
   gives those two buttons exactly that padding, and the negative margin only existed to close
   `.sources`'s 14px gap — `.jumpbar`'s gap is 6px, so re-tuning it is pointless where deleting it
   is correct. Deletion over addition.
5. Update the task-271/273 comment block above those rules to match what survives.
6. Do NOT add a `flex-wrap` or a second `margin-left: auto` to `.jumpbar`: it already has
   `flex-basis: 100%` on a `flex-wrap: wrap` header, so it owns its own full-width row and cannot
   collide with `.zoombar`/`.layerbar` (which is exactly why task 256 put it there). Leave
   `size="22"` and the placeholder text alone — a full-width row has the space.

---

## Step 5 — Task 288: the File Nav drag stops relaying out the canvas

Cause, confirmed by reading: `setFileNavWidthFromPointer` writes `--filenav-w` on `.stagewrap` on
every `pointermove`; `.filenav`'s `width` reads that property, `.filenav` is a flex SIBLING of
`main.timelines` inside `.stagewrap`, and that pane holds the ~800-widget, ~156,000 px `.canvas`.
So each move reflows the flex row and the whole canvas.

The user's own suggestion — defer drawing the dashed leader lines until release — needs NO separate
work once the fix below lands, and must not be implemented on top of it. The 683 full-canvas dashed
lines are indeed the expensive thing to repaint, but they only repaint because the pane's width
changed mid-drag; candidate (c) stops writing `--filenav-w` until release, so during the drag the
timeline pane's box never changes and the leaders are never invalidated at all. Hiding and
re-showing them would be a second mechanism for a cost that is already gone.

Candidate (a), `requestAnimationFrame` coalescing, is REJECTED: browsers already coalesce
`pointermove` to about one event per frame, so it removes nearly no work — the per-frame full
relayout survives it. Take candidate (c): during the drag write a **preview-only** property that
only `.filenav-grip` reads. The grip is `position: absolute` against `.stagewrap` and out of the
flex row, so moving it reflows nothing; the pane's width is committed once, on release.

### 5a — RED: two new tests in `tests/layer1-filenav-resize.test.ts`

That file's existing `dragGripTo` drives a complete pointerdown/pointermove/pointerup drag, so its
three current tests keep passing unchanged. Add a helper that stops mid-drag:

```ts
// Press and move WITHOUT releasing, so the in-progress state is observable.
function startDragToward(clientX: number): void {
    const grip = document.getElementById("filenav-grip")!;
    grip.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX: 232 }));
    window.dispatchEvent(new window.MouseEvent("pointermove", { clientX }));
}

function readFileNavDragWidth(): string {
    return document.getElementById("stagewrap")!.style.getPropertyValue("--filenav-drag-w");
}

test("test_a_drag_in_progress_moves_the_preview_and_not_the_pane", async () => {
    // Scenario (task 288): every pointermove used to write the pane's own width, and the pane is a
    // flex sibling of the ~156,000px timeline canvas, so each move relaid out the whole canvas and
    // the drag was unusable. Only the preview property may move while the button is down.
    // Steps:
    // open the page and press-and-move without releasing.
    openResizablePage();
    startDragToward(340);
    // the preview carries the pointer's width...
    assert.equal(readFileNavDragWidth(), "340px");
    // ...and the pane's own width has not moved off its default, so nothing relaid out.
    assert.equal(readFileNavWidth(), "");
    // and the grip reads as a live preview line.
    assert.ok(document.getElementById("filenav-grip")!.classList.contains("dragging"));
});

test("test_releasing_the_drag_commits_the_width_and_drops_the_preview", async () => {
    // Scenario (task 288): the pane must still end up where the user let go — the preview is the
    // only thing that is cheap, so the real width is written exactly once, on release.
    // Steps:
    // open the page and complete a drag out to 340px.
    openResizablePage();
    dragGripTo(340);
    // the pane's shared width is committed...
    assert.equal(readFileNavWidth(), "340px");
    // ...the preview property is gone, so `.filenav-grip` falls back to reading the committed width.
    assert.equal(readFileNavDragWidth(), "");
    // ...and the grip is no longer painted as a drag in progress.
    assert.equal(document.getElementById("filenav-grip")!.classList.contains("dragging"), false);
});
```

### 5b — GREEN: `webapp/layer1-filenav-resize.ts`

1. Keep `MIN_FILENAV_WIDTH_PX`, `MAX_FILENAV_WIDTH_PX` and `clampFileNavWidth` exactly as they are.
2. Replace `setFileNavWidthFromPointer` with two functions over one shared width reader, so the
   preview and the commit can never clamp or measure differently:

```ts
// The pane width a pointer at `clientX` asks for: the distance from the wrapper's left edge, since
// `.filenav` is the wrapper's first flex child and starts there. Reading the WRAPPER, not the pane,
// is what keeps the number independent of the width this drag is changing.
function readFileNavWidthAtPointer(stagewrap: HTMLElement, clientX: number): number {
    return clampFileNavWidth(clientX - stagewrap.getBoundingClientRect().left);
}

// While the button is down, publish the width as a PREVIEW only. `--filenav-drag-w` is read by
// nothing but `.filenav-grip`'s `left`, and the grip is `position: absolute` against .stagewrap and
// outside the flex row — so a move repaints one 6px element instead of relaying out `.filenav`, its
// flex sibling `main.timelines`, and the ~156,000px canvas of ~800 widgets inside it (task 288).
function previewFileNavWidth(stagewrap: HTMLElement, clientX: number): void {
    stagewrap.style.setProperty("--filenav-drag-w", `${readFileNavWidthAtPointer(stagewrap, clientX)}px`);
}

// On release, write the width the pane, the minimap and the grip all read — once per drag. Removing
// the preview property is what hands `.filenav-grip` back to its `var(--filenav-drag-w, ...)`
// fallback; leaving it set would pin the grip to the drag's last position forever.
function commitFileNavWidth(stagewrap: HTMLElement, clientX: number): void {
    stagewrap.style.setProperty("--filenav-w", `${readFileNavWidthAtPointer(stagewrap, clientX)}px`);
    stagewrap.style.removeProperty("--filenav-drag-w");
}
```

3. In `wireFileNavResize`'s `pointerdown` handler: keep `event.preventDefault()` and the
   window-scoped listeners with their existing comment, then
   - add `grip.classList.add("dragging")` and `previewFileNavWidth(stagewrap, (event as MouseEvent).clientX)`
     on press, so the preview line exists from the first frame rather than only after the first move;
   - `pointermove` → `previewFileNavWidth(...)`;
   - `pointerup` → `commitFileNavWidth(stagewrap, (release as MouseEvent).clientX)`, then
     `grip.classList.remove("dragging")`, then remove both listeners. The release event's own
     `clientX` is the pointer's final position, so no last-move variable has to be carried.
4. Update the module header comment: the drag now writes a preview property per move and the shared
   `--filenav-w` once on release, and WHY (the flex-sibling relayout of the whole canvas).

### 5c — GREEN: `webapp/layer1-styles.css`

1. `.filenav-grip`'s `left` becomes `calc(var(--filenav-drag-w, var(--filenav-w)) - 3px)` — the
   nested `var()` fallback is what makes the grip track the live drag while it is set and the
   committed width the rest of the time, with no JS reading either value back.
2. Give the drag state the hover treatment it already has, by adding the class to that selector:
   `.filenav-grip:hover, .filenav-grip.dragging { background: color-mix(in srgb, var(--sel-edge) 45%, transparent); }`
   — the grip is 6 px wide, so this IS the "lightweight preview line" and no new element is needed.
3. Extend the `.filenav-grip` comment with the preview/commit split and the reason: the grip is the
   only thing that may move per frame.

---

## Step 6 — Wrap up

1. Re-read each edited file to confirm no rule or comment was left describing behaviour that has
   changed (`.leaders`' task-265 paragraph, the find-file 1.5 s paragraph, the task-271/273
   `.sources` comment, the filenav-resize header).
2. Confirm no file crossed the repo's 250-line cap: `layer1-styles.css` (393 lines) is exempt as
   CSS by existing practice, but `layer1-find-file.ts` (188) NET SHRINKS here, and
   `layer1-ruler-click.ts` (105) and `layer1-filenav-resize.ts` (54) stay far below.
3. Run `npm run build:webapp` only if that is what emits `/app/*.js` for the page; do NOT run the
   test suite.
4. Report to the user, per the memory note that visual verification is theirs: hard-reload the
   Layer 1 View and check (287) a hovered long name reveals in orange, (285) the find widget sits
   right of the `No on-disk match` button, (283/267) a ruler tick click leaves a green outline on
   the node or bubble it landed on and only one stays lit, (288) the File Nav drag is smooth and
   the pane snaps to the release point, (290) the dashed lines and gutter timestamps now cross the
   dots instead of sitting above them.
