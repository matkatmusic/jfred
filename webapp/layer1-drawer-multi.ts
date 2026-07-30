// Task 329: the File Nav's detail pipeline plus the shift-click range gesture — one DiffView per file.

import { getRequiredElementById } from "./app-dom.ts";
import { DiffPaneMode, type DiffStep } from "./layer1-diff-pane.ts";
import { buildDiffView, displayDetailView } from "./layer1-diff-view.ts";
import { clearDiffPair, setDrawerTools } from "./layer1-drawer-diff.ts";
import { paintDiffWash, readDrawnView, readNavTargets, readNodeInstant, resolveRangeStepIndexes } from "./layer1-diff-wash.ts";
import { describeCommitStep, describeDiskStep, describeSnapshotStep } from "./layer1-revision-sources.ts";
import { formatInstantLabel } from "./layer1-ruler-rows.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

// A shift-clicked pair resolves to two global instants; each file diffs across that range.
export type DiffWashRange = { baseInstant: string; targetInstant: string };

// Every diffable revision of one path with its instant, oldest first: commits, snapshots, disk.
function listDatedSteps(view: WireLayer1View, path: string): { instant: string; step: DiffStep }[] {
    const pair = view.pairs.find((candidate) => candidate.path === path);
    const diskOrphan = view.diskOrphans.find((candidate) => candidate.path === path);
    if (pair === undefined && diskOrphan === undefined) {
        return [];
    }
    const dated: { instant: string; step: DiffStep }[] = [
        ...(pair?.commits ?? []).map((commit) => ({
            instant: commit.instant,
            step: describeCommitStep(path, commit.hash),
        })),
        ...((pair?.snapshots ?? diskOrphan?.snapshots) ?? []).map((snapshot) => ({
            instant: snapshot.instant,
            step: describeSnapshotStep(path, snapshot),
        })),
        { instant: (pair?.onDisk ?? diskOrphan!).instant, step: describeDiskStep(path) },
    ];
    return dated.sort((a, b) => Date.parse(a.instant) - Date.parse(b.instant));
}

// The steps alone, order preserved; the nav flow needs no instants.
export function listDiffableSteps(view: WireLayer1View, path: string): DiffStep[] {
    return listDatedSteps(view, path).map((entry) => entry.step);
}

// One file's pane inside a range: its base/target derive from the wash, or an empty-range body.
function buildRangeView(view: WireLayer1View, path: string, range: DiffWashRange): HTMLElement {
    const dated = listDatedSteps(view, path);
    const indexes = resolveRangeStepIndexes(dated.map((entry) => entry.instant), range.baseInstant, range.targetInstant);
    if (indexes === undefined) {
        return buildDiffView(path, [], {
            revisionControlsShown: false, mode: DiffPaneMode.inline, fullContents: false,
            baseIndex: 0, targetIndex: 0, emptyText: "No state inside the selected range.",
        });
    }
    return buildDiffView(path, dated.map((entry) => entry.step), {
        revisionControlsShown: true, mode: DiffPaneMode.inline, fullContents: false,
        baseIndex: indexes.baseIndex, targetIndex: indexes.targetIndex,
    });
}

// Files in, self-contained panes out; a range switches each pane from on-disk to its wash pair.
export function createDetailViewsForFiles(view: WireLayer1View, files: string[], range?: DiffWashRange): HTMLElement[] {
    const sorted = [...files].sort();
    return sorted.map((path) => {
        if (range !== undefined) {
            return buildRangeView(view, path, range);
        }
        const steps = listDiffableSteps(view, path);
        return buildDiffView(path, steps, {
            // A lone selection has nothing to step or widen; 2+ files justify the revision controls.
            revisionControlsShown: files.length > 1,
            mode: DiffPaneMode.inline,
            fullContents: true,
            baseIndex: Math.max(0, steps.length - 1),
            targetIndex: Math.max(0, steps.length - 1),
        });
    });
}

// The File Nav entry point: chrome, then the two-step pipeline above.
export function showDetailViewForFiles(view: WireLayer1View, targets: string[]): void {
    clearDiffPair();
    setDrawerTools("none");
    // The single-node ↑↓ step a stale timeline anchor, so the nav flow hides them.
    getRequiredElementById("dprev").hidden = true;
    getRequiredElementById("dnext").hidden = true;
    const sorted = [...targets].sort();
    const header = getRequiredElementById("dpath");
    // A lone file is named ONCE, here; its section plate is removed by displayDetailView.
    header.textContent = sorted.length === 1
        ? `${sorted[0]!.split("/").pop()} — Current on-disk state`
        : `${sorted.length} files — Current on-disk state`;
    header.title = sorted.join("\n");
    getRequiredElementById("dmeta").textContent = `working tree   ·   ${sorted.length} selected`;
    displayDetailView(createDetailViewsForFiles(view, sorted));
}

// Task 329: the second shift-clicked node closes a global range wash; every nav-selected file diffs across it.
export function extendDiffSelection(anchor: { node: HTMLElement; path: string }, node: HTMLElement, path: string): void {
    if (anchor.node === node) {
        return;
    }
    const view = readDrawnView();
    if (view === undefined) {
        return;
    }
    const anchorInstant = readNodeInstant(view, anchor.path, anchor.node);
    const nodeInstant = readNodeInstant(view, path, node);
    if (anchorInstant === undefined || nodeInstant === undefined) {
        return;
    }
    // Direction comes from the instant, never click order: earlier is base, later is target.
    const [baseNode, baseInstant, targetInstant] = Date.parse(anchorInstant) <= Date.parse(nodeInstant)
        ? [anchor.node, anchorInstant, nodeInstant]
        : [node, nodeInstant, anchorInstant];
    const targetNode = baseNode === anchor.node ? node : anchor.node;
    for (const lit of document.querySelectorAll(".found, .diff-base, .diff-target")) {
        lit.classList.remove("found", "diff-base", "diff-target");
    }
    baseNode.classList.add("diff-base");
    targetNode.classList.add("diff-target");
    paintDiffWash(baseInstant, targetInstant, view.ruler);
    const files = [...new Set([...readNavTargets(), anchor.path, path])].sort();
    const header = getRequiredElementById("dpath");
    header.textContent = files.length === 1
        ? `${files[0]!.split("/").pop()} — range diff`
        : `${files.length} files — range diff`;
    header.title = files.join("\n");
    getRequiredElementById("dmeta").textContent =
        `base ${formatInstantLabel(baseInstant)} → target ${formatInstantLabel(targetInstant)}`;
    setDrawerTools("none");
    getRequiredElementById("dprev").hidden = true;
    getRequiredElementById("dnext").hidden = true;
    displayDetailView(createDetailViewsForFiles(view, files, { baseInstant, targetInstant }));
}

export function wireMultiFileDrawer(): void {
    const setEverySectionOpen = (open: boolean): void => {
        for (const section of document.querySelectorAll<HTMLDetailsElement>("#dbody details.dfile")) {
            section.open = open;
        }
    };
    getRequiredElementById("dcollapse-all").addEventListener("click", () => setEverySectionOpen(false));
    getRequiredElementById("dshow-all").addEventListener("click", () => setEverySectionOpen(true));
}
