// The assertion layer: the four Layer 1 failure modes this project keeps re-reporting, expressed as
// checks over one state's geometry dump rather than over the DOM. Reading a dump rather than the
// live page is what makes a violation reproducible — the artifact that failed is on disk.
//
// Every check is a REGRESSION GUARD. Each one names a bug that shipped, passed its unit tests, and
// was found by eye afterwards (tasks 245-250 overlapping bubbles, task 245 label overprinting,
// task 284 bucket titles in the tick list, task 277 the jump that only scrolled sideways).

import { BUCKET_TITLES, type Box, type Measured, type StateGeometry } from "./geometry.ts";

// Sub-pixel slack. Rects come back rounded to 1/100 px and adjacent borders legitimately touch, so
// only a real overlap wider than this counts.
const OVERLAP_EPSILON = 0.5;

// How much taller than one line an element may be before it is called wrapped. 1.6x clears normal
// line-height rounding without reaching a genuine second line.
const WRAP_HEIGHT_RATIO = 1.6;

export interface Violation {
    rule: string;
    state: string;
    detail: string;
}

function overlaps(left: Box, right: Box): boolean {
    return left.x + left.w - OVERLAP_EPSILON > right.x
        && right.x + right.w - OVERLAP_EPSILON > left.x
        && left.y + left.h - OVERLAP_EPSILON > right.y
        && right.y + right.h - OVERLAP_EPSILON > left.y;
}

function describe(measured: Measured): string {
    const name = measured.ownerPath ?? measured.path ?? measured.text;
    const { x, y, w, h } = measured.box;
    return `${name} "${measured.text.trim()}" at ${x},${y} ${w}x${h}`;
}

// The rects after `index` that collide with the one at `index`, stopping as soon as a candidate
// starts past its right edge — which is only sound because `sorted` is ordered by x.
function listCollisionsAfter(sorted: Measured[], index: number): [Measured, Measured][] {
    const current = sorted[index]!;
    const pairs: [Measured, Measured][] = [];
    for (let other = index + 1; other < sorted.length; other += 1) {
        const candidate = sorted[other]!;
        if (candidate.box.x >= current.box.x + current.box.w) {
            break;
        }
        pairs.push([current, candidate]);
    }
    return pairs.filter(([left, right]) => overlaps(left.box, right.box));
}

// Every colliding pair in a set of rects.
function listCollidingPairs(measured: Measured[]): [Measured, Measured][] {
    const sorted = [...measured].sort((left, right) => left.box.x - right.box.x);
    return sorted.flatMap((_, index) => listCollisionsAfter(sorted, index));
}

// Rule 1: two things drawn on top of each other. Nodes are grouped by LANE because two dots at one
// instant are meant to be stacked on their own 22 px rows (tasks 251/259) — an overlap there means
// the tie-group stacking failed. Bubbles are checked against each other because a negative
// `--axis-px` offset is what drew one over its neighbour (tasks 247-249).
export function findOverlaps(geometry: StateGeometry): Violation[] {
    const byLane = new Map<number, Measured[]>();
    for (const node of geometry.nodes) {
        byLane.set(node.laneIndex, [...(byLane.get(node.laneIndex) ?? []), node]);
    }
    const nodePairs = [...byLane.values()].flatMap(listCollidingPairs);
    const boxPairs = listCollidingPairs(geometry.fileboxes);
    return [...nodePairs, ...boxPairs].map(([left, right]) => ({
        rule: "overlapping-nodes",
        state: geometry.state,
        detail: `${describe(left)} overlaps ${describe(right)}`,
    }));
}

// Rule 2: a commit row's text is wrapped, or it runs out of its own bubble and paints over another.
// `.nlabel` is `white-space: nowrap` and is NOT clipped, so a label wider than its 168 px bubble
// overprints its neighbours — the exact reason the commit hash was shortened to 8 characters.
// `.fname` is deliberately ellipsised and is not checked for width.
export function findTextOverflow(geometry: StateGeometry): Violation[] {
    const wrapped = geometry.labels
        .filter((label) => label.lineHeight > 0 && label.box.h > label.lineHeight * WRAP_HEIGHT_RATIO)
        .map((label) => ({
            rule: "wrapped-commit-row",
            state: geometry.state,
            detail: `${describe(label)} is ${label.box.h}px tall against a ${label.lineHeight}px line`,
        }));
    const boxesByPath = new Map(geometry.fileboxes.map((box) => [box.ownerPath ?? box.text, box]));
    const spilled = geometry.labels.flatMap((label) => {
        const owner = boxesByPath.get(label.ownerPath ?? label.text);
        if (owner === undefined || label.box.x + label.box.w <= owner.box.x + owner.box.w) {
            return [];
        }
        const hit = geometry.fileboxes.find((box) => box !== owner && overlaps(label.box, box.box));
        if (hit === undefined) {
            return [];
        }
        return [{
            rule: "commit-row-overprints-neighbour",
            state: geometry.state,
            detail: `${describe(label)} runs past its bubble and paints over ${hit.ownerPath ?? hit.text}`,
        }];
    });
    return [...wrapped, ...spilled];
}

// Rule 3: a bubble labelled with an orphan BUCKET heading instead of the file it stands for. A real
// pair bubble always carries the full repo-relative path on `data-path` (task 280) and never prints
// a bucket heading; the tick list's buttons are checked the same way, since task 284's list is built
// from the bubbles and inherited the same confusion.
export function findBucketTitleLabels(geometry: StateGeometry): Violation[] {
    const isBucketTitle = (text: string) => BUCKET_TITLES.some((title) => title === text.trim());
    const mislabelled = geometry.fnames
        .filter((name) => !name.isBucket && (isBucketTitle(name.text) || name.path === null))
        .map((name) => ({
            rule: "bucket-title-as-file-label",
            state: geometry.state,
            detail: `pair bubble prints "${name.text.trim()}" with data-path=${name.path ?? "(missing)"}`,
        }));
    const inTickList = geometry.tickFiles
        .filter((button) => isBucketTitle(button.text))
        .map((button) => ({
            rule: "bucket-title-in-tick-list",
            state: geometry.state,
            detail: `expanded ruler row lists "${button.text.trim()}" as though it were a file`,
        }));
    return [...mislabelled, ...inTickList];
}

// Rule 4: what a jump landed on is not actually on screen. The container is `#timelines`, not the
// window: the stage is ~156,000 px wide inside a scroll pane, so a bubble can be perfectly placed in
// the document and still be nowhere the reader can see. Checked only when something is lit, since
// `.found` is what a landing sets and no jump means nothing to verify.
export function findOffscreenLandings(geometry: StateGeometry): Violation[] {
    const pane = geometry.scroller;
    const where = `${pane.x},${pane.y} ${pane.w}x${pane.h}`;
    return geometry.found
        .filter((landed) => !overlaps(landed.box, pane))
        .map((landed) => ({
            rule: "landing-outside-viewport",
            state: geometry.state,
            detail: `${describe(landed)} is outside the timeline pane at ${where}`,
        }));
}

// Every rule against one state.
export function checkStateGeometry(geometry: StateGeometry): Violation[] {
    return [
        ...findOverlaps(geometry),
        ...findTextOverflow(geometry),
        ...findBucketTitleLabels(geometry),
        ...findOffscreenLandings(geometry),
    ];
}
