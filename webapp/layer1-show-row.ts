// Task 385: show-row mockup, one checkbox per node kind in the view; filtering waits for task 360.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

// Order is the order the checkboxes print; values double as the swatch class suffix and the `data-kind` attribute.
export const ShowRowKind = {
  created: "created",
  commit: "commit",
  disk: "disk",
  snapshot: "snapshot",
  edit: "edit",
  scriptRun: "script-run",
  branch: "branch",
} as const;
export type ShowRowKind = (typeof ShowRowKind)[keyof typeof ShowRowKind];

export const SHOW_ROW_LABELS: Record<ShowRowKind, string> = {
  [ShowRowKind.created]: "created at",
  [ShowRowKind.commit]: "commit",
  [ShowRowKind.disk]: "on-disk",
  [ShowRowKind.snapshot]: "📸 snapshot",
  [ShowRowKind.edit]: "edit",
  [ShowRowKind.scriptRun]: "script run",
  [ShowRowKind.branch]: "branch",
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
    [ShowRowKind.branch]: true,
  };
  return Object.values(ShowRowKind).filter((kind) => present[kind]);
}

function buildKindCheckbox(kind: ShowRowKind): HTMLElement {
  const box = createElement("input", { type: "checkbox", "data-kind": kind });
  (box as HTMLInputElement).checked = true;
  return createElement("label", { class: "show-kind" }, [box, createElement("i", { class: `swatch sw-${kind}` }), SHOW_ROW_LABELS[kind]]);
}

// The arrows sit outside the label so a click never toggles the box; layer1-kind-jump.ts wires them.
export const KindJumpDirection = { previous: "previous", next: "next" } as const;
export type KindJumpDirection = (typeof KindJumpDirection)[keyof typeof KindJumpDirection];

const KIND_JUMP_SYMBOLS: Record<KindJumpDirection, string> = {
  [KindJumpDirection.previous]: "<",
  [KindJumpDirection.next]: ">",
};

function buildKindColumn(kind: ShowRowKind): HTMLElement {
  const arrows = Object.values(KindJumpDirection).map((direction) => createElement("button", {
    type: "button", class: "kind-jump", "data-jump-kind": kind, "data-jump": direction,
    title: `${direction} ${SHOW_ROW_LABELS[kind]}`, text: KIND_JUMP_SYMBOLS[direction],
  }));
  return createElement("div", { class: "show-kind-col" }, [buildKindCheckbox(kind), createElement("div", { class: "kind-jumps" }, arrows)]);
}

export function renderShowRow(view: ShowRowView): void {
  getRequiredElementById("show-row").replaceChildren(
    createElement("span", { class: "lbl", text: "show:" }),
    ...listPresentKinds(view).map(buildKindColumn),
  );
}
