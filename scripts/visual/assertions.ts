// Regression guards for four recurring Layer 1 visual failure modes.
//
// Checks: overlapping bubbles, label overprint, bucket-title leak, off-screen jumps.

import { BUCKET_TITLES, type Box, type Measured, type StateGeometry } from "./geometry.ts";

// Sub-pixel slack: adjacent borders legitimately touch, so only overlaps wider than this count.
const OVERLAP_EPSILON = 0.5;

// 1.6x clears line-height rounding without reaching a genuine second line.
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

// Collisions after `index`, stopping when candidates start past its right edge (requires x-sorted input).
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

// Rule 1: overlapping nodes per lane (tasks 251/259) or bubbles (tasks 247-249).
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

// Rule 2: wrapped or spilled commit-row text; `.nlabel` is nowrap/unclipped so long text overprints neighbours.
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

// Rule 3: bubble or tick-list entry showing a bucket heading instead of a file path (tasks 280/284).
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

// Rule 4: verify the lit bubble is within the scroll pane's visible viewport.
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

