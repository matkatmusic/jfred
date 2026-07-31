// Task 329: the base/target instant wash — two shift-clicked nodes become one global range.

import { el, getRequiredElementById } from "./app-dom.ts";
import { resolveAxisPixelsAt } from "./layer1-ranges.ts";
import { spawnWash } from "./layer1-wash.ts";
import { RULER_NODE_ROW_PIXELS } from "./layer1-ruler-axis.ts";
import type { WireLayer1View, WireRulerTick } from "./layer1-wire.ts";

// The view the stage last DREW (post-filter), because the wash and the steps must match the drawn axis.
let drawnView: WireLayer1View | undefined;
// The File Nav selection; the wash diffs these files plus the two clicked ones.
let navTargets: string[] = [];

export function rememberDrawnView(view: WireLayer1View): void {
    drawnView = view;
}

export function rememberNavTargets(targets: string[]): void {
    navTargets = targets;
}

export function readDrawnView(): WireLayer1View | undefined {
    return drawnView;
}

export function readNavTargets(): string[] {
    return navTargets;
}

// The one inside-the-range test every caller below shares: is ms within [from, to], inclusive?
function fallsInRange(ms: number, fromMs: number, toMs: number): boolean {
    return ms >= fromMs && ms <= toMs;
}

// base = first step inside the range, target = last inside; an empty range holds its preceding state.
export function resolveRangeStepIndexes(instants: string[], baseInstant: string, targetInstant: string): { baseIndex: number; targetIndex: number } | undefined {
    const fromMs = Date.parse(baseInstant);
    const toMs = Date.parse(targetInstant);
    const stepsMs = instants.map((instant) => Date.parse(instant));
    const baseIndex = stepsMs.findIndex((ms) => fallsInRange(ms, fromMs, toMs));
    if (baseIndex >= 0) {
        let targetIndex = baseIndex;
        while (targetIndex + 1 < stepsMs.length && stepsMs[targetIndex + 1]! <= toMs) {
            targetIndex += 1;
        }
        return { baseIndex, targetIndex };
    }
    for (let index = stepsMs.length - 1; index >= 0; index -= 1) {
        if (stepsMs[index]! < fromMs) {
            return { baseIndex: index, targetIndex: index };
        }
    }
    // Every step post-dates the range: the file had no state inside it.
    return undefined;
}

// Task 336: does ANY instant land inside the range — the file-list sweep test, not a step-picking one.
export function hasInstantInRange(instants: string[], baseInstant: string, targetInstant: string): boolean {
    const fromMs = Date.parse(baseInstant);
    const toMs = Date.parse(targetInstant);
    return instants.some((instant) => fallsInRange(Date.parse(instant), fromMs, toMs));
}

// A lane node resolved to its wire instant: hash for a commit, version+session for a snapshot, else on-disk.
export function readNodeInstant(view: WireLayer1View, path: string, node: HTMLElement): string | undefined {
    const pair = view.pairs.find((candidate) => candidate.path === path);
    const orphan = view.diskOrphans.find((candidate) => candidate.path === path);
    if (node.classList.contains("n-commit")) {
        return pair?.commits.find((commit) => commit.hash === node.title)?.instant;
    }
    if (node.classList.contains("n-snap")) {
        return ((pair?.snapshots ?? orphan?.snapshots) ?? []).find((snapshot) =>
            String(snapshot.version) === node.dataset.version && snapshot.sessionId === node.dataset.sessionId)?.instant;
    }
    return (pair?.onDisk ?? orphan)?.instant;
}

// A node's instant always owns a ruler tick; a merged or re-laid row falls back to interpolation.
export function axisPixelsForInstant(instant: string, ruler: readonly WireRulerTick[]): number {
    const exact = ruler.find((tick) => tick.instant === instant);
    return exact === undefined ? resolveAxisPixelsAt(Date.parse(instant), ruler) : exact.axisPx;
}

// The last range painted, so a stage re-render (which wipes #washes wholesale) can repaint it.
let diffWashRange: { baseInstant: string; targetInstant: string } | undefined;

export function clearDiffWash(): void {
    diffWashRange = undefined;
    for (const wash of document.querySelectorAll(".diff-wash, .wash-edge")) {
        wash.remove();
    }
}

// The gutter names the wash's edges (user feedback, 2026-07-30): the ruler row nearest each boundary.
function labelWashEdgeTick(axisPx: number, edge: "base" | "target"): void {
    const ticks = [...getRequiredElementById("ruler").querySelectorAll<HTMLElement>(".tick")];
    const nearest = ticks.reduce((best: HTMLElement | undefined, tick) => {
        const distance = Math.abs(Number(tick.style.getPropertyValue("--axis-px")) - axisPx);
        const bestDistance = best === undefined
            ? Number.POSITIVE_INFINITY
            : Math.abs(Number(best.style.getPropertyValue("--axis-px")) - axisPx);
        return distance < bestDistance ? tick : best;
    }, undefined);
    nearest?.append(el("div", { class: `wash-edge ${edge}`, text: `selected diff range ${edge}` }));
}

function drawDiffWash(baseInstant: string, targetInstant: string, ruler: readonly WireRulerTick[]): void {
    const topPx = axisPixelsForInstant(baseInstant, ruler) - RULER_NODE_ROW_PIXELS / 2;
    const footPx = axisPixelsForInstant(targetInstant, ruler) + RULER_NODE_ROW_PIXELS / 2;
    const wash = spawnWash(topPx, footPx, "var(--sel-edge)");
    wash.classList.add("diff-wash");
    getRequiredElementById("washes").append(wash);
    labelWashEdgeTick(axisPixelsForInstant(baseInstant, ruler), "base");
    labelWashEdgeTick(axisPixelsForInstant(targetInstant, ruler), "target");
}

// Half a row clear of both boundary nodes, exactly as the session wash closes on its covered events.
export function paintDiffWash(baseInstant: string, targetInstant: string, ruler: readonly WireRulerTick[]): void {
    clearDiffWash();
    diffWashRange = { baseInstant, targetInstant };
    drawDiffWash(baseInstant, targetInstant, ruler);
}

// Every stage render replaces #washes wholesale; repaint the remembered range so it survives.
export function repaintDiffWash(ruler: readonly WireRulerTick[]): void {
    if (diffWashRange !== undefined) {
        drawDiffWash(diffWashRange.baseInstant, diffWashRange.targetInstant, ruler);
    }
}
