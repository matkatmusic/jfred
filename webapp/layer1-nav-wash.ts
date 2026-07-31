// Task 333: the File Nav selection's own wash — oldest→newest event across the selected files' drawn ladders.

import { getRequiredElementById } from "./app-dom.ts";
import { axisPixelsForInstant } from "./layer1-diff-wash.ts";
import { RULER_NODE_ROW_PIXELS } from "./layer1-ruler-axis.ts";
import { spawnWash } from "./layer1-wash.ts";
import { listOrphanLadderInstants, listPairLadderInstants } from "./layer1-wire.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

// ponytail: gitOrphans excluded per the brief's ladder list; add them here if that scope changes.
export function resolveNavWashInstants(view: WireLayer1View, targets: readonly string[]): { oldest: string; newest: string } | undefined {
    const selected = new Set(targets);
    const instants = [
        ...view.pairs.filter((pair) => selected.has(pair.path)).flatMap(listPairLadderInstants),
        ...view.diskOrphans.filter((orphan) => selected.has(orphan.path)).flatMap(listOrphanLadderInstants),
    ];
    if (instants.length === 0) {
        return undefined;
    }
    return instants.reduce((range, instant) => ({
        oldest: Date.parse(instant) < Date.parse(range.oldest) ? instant : range.oldest,
        newest: Date.parse(instant) > Date.parse(range.newest) ? instant : range.newest,
    }), { oldest: instants[0]!, newest: instants[0]! });
}

export function clearNavWash(): void {
    for (const wash of document.querySelectorAll(".nav-wash")) {
        wash.remove();
    }
}

// Every stage render replaces #washes wholesale, so this repaints fresh each time, not just on selection change.
export function renderNavWash(view: WireLayer1View, targets: readonly string[]): void {
    clearNavWash();
    const range = resolveNavWashInstants(view, targets);
    if (range === undefined) {
        return;
    }
    const topPx = axisPixelsForInstant(range.oldest, view.ruler) - RULER_NODE_ROW_PIXELS / 2;
    const footPx = axisPixelsForInstant(range.newest, view.ruler) + RULER_NODE_ROW_PIXELS / 2;
    const wash = spawnWash(topPx, footPx, "var(--c-echo)");
    wash.classList.add("nav-wash");
    getRequiredElementById("washes").append(wash);
}
