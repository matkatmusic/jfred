// Task 385: show-row mockup, one checkbox per node kind in the view; filtering waits for task 360.

import { el, getRequiredElementById } from "./app-dom.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

// Order is the order the checkboxes print; values double as the swatch class suffix and the `data-kind` attribute.
export const ShowRowKind = {
    created: "created",
    commit: "commit",
    disk: "disk",
    snapshot: "snapshot",
    edit: "edit",
    scriptRun: "script-run",
} as const;
export type ShowRowKind = (typeof ShowRowKind)[keyof typeof ShowRowKind];

const SHOW_ROW_LABELS: Record<ShowRowKind, string> = {
    [ShowRowKind.created]: "created at",
    [ShowRowKind.commit]: "commit",
    [ShowRowKind.disk]: "on-disk",
    [ShowRowKind.snapshot]: "📸 snapshot",
    [ShowRowKind.edit]: "edit",
    [ShowRowKind.scriptRun]: "script run",
};

type ShowRowView = Pick<WireLayer1View, "pairs" | "gitOrphans" | "diskOrphans">;

// Kinds present in the view, in ShowRowKind order. Absent kinds get no box; Edit and script run are always present.
export function listPresentKinds(view: ShowRowView): ShowRowKind[] {
    const owners = [...view.pairs, ...view.gitOrphans, ...view.diskOrphans];
    const present: Record<ShowRowKind, boolean> = {
        [ShowRowKind.created]: view.pairs.some((pair) => pair.created !== undefined),
        [ShowRowKind.commit]: view.pairs.some((pair) => pair.commits.length > 0),
        [ShowRowKind.disk]: view.pairs.length > 0 || view.diskOrphans.length > 0,
        [ShowRowKind.snapshot]: owners.some((owner) => (owner.snapshots ?? []).length > 0),
        [ShowRowKind.edit]: true,
        // [ShowRowKind.scriptRun]: view.pairs.some((pair) => (pair.scriptRuns ?? []).length > 0),
        [ShowRowKind.scriptRun]: true,
    };
    return Object.values(ShowRowKind).filter((kind) => present[kind]);
}

function buildKindCheckbox(kind: ShowRowKind): HTMLElement {
    const box = el("input", { type: "checkbox", "data-kind": kind });
    (box as HTMLInputElement).checked = true;
    return el("label", { class: "show-kind" }, [box, el("i", { class: `swatch sw-${kind}` }), SHOW_ROW_LABELS[kind]]);
}

export function renderShowRow(view: ShowRowView): void {
    getRequiredElementById("show-row").replaceChildren(
        el("span", { class: "lbl", text: "show:" }),
        ...listPresentKinds(view).map(buildKindCheckbox),
    );
}
