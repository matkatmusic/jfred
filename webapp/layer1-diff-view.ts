// Task 329: THE DiffView — one self-contained pane per file, used by node clicks, pairs, and nav selections.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import { DiffPaneMode, createDiffPane, type DiffPaneModeValue, type DiffStep } from "./layer1-diff-pane.ts";
import { isImagePath, renderImageInto } from "./layer1-drawer-image.ts";

export type DiffViewConfig = {
  // Arrows + the tools row drop for a lone selection: nothing to step, diff, or widen.
  revisionControlsShown: boolean;
  mode: DiffPaneModeValue;
  fullContents: boolean;
  baseIndex: number;
  targetIndex: number;
  onSidesChanged?: (baseIndex: number, targetIndex: number) => void;
  // The zero-steps body text; a range that caught no state overrides the deleted-file default.
  emptyText?: string;
};

function getBasename(path: string): string {
  return path.split("/").pop() ?? path;
}

function buildArrowButton(glyph: "↑" | "↓", side: string): HTMLButtonElement {
  const direction = glyph === "↑" ? "previous" : "next";
  return createElement("button", { text: glyph, title: `${direction} ${side} revision` }) as HTMLButtonElement;
}

// The single-pair drawer's three header rows (dhead/dpair/dfull-toggle/dmeta classes) plus the body.
export function buildDiffView(path: string, steps: DiffStep[], config: DiffViewConfig): HTMLElement {
  const details = createElement("details", { class: "dfile", open: "" });
  const namePlate = createElement("div", { class: "dpath dfile-path", text: getBasename(path), title: path, "data-target": path });
  if (steps.length === 0) {
    details.append(createElement("summary", { class: "dhead dfile-head" }, [namePlate]),
      createElement("div", { class: "dbinary", text: config.emptyText ?? "Deleted — no on-disk state to show." }));
    return details;
  }
  // An image section shows the target revision as a picture — the text-diff pipeline never sees it.
  const isImage = isImagePath(path);
  if (isImage) {
    const params = steps[config.targetIndex]!.buildParams();
    params.set("binary", "1");
    const imageBody = createElement("div", { class: "dfile-body" });
    renderImageInto(imageBody, `/api/layer1-file?${params}`);
    details.append(createElement("summary", { class: "dhead dfile-head" }, [namePlate]), imageBody);
    return details;
  }
  const arrows: [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement, HTMLButtonElement] = [
    buildArrowButton("↑", "base"), buildArrowButton("↓", "base"),
    buildArrowButton("↑", "target"), buildArrowButton("↓", "target"),
  ];
  const pairLabel = createElement("span", { class: "dpair" });
  // const revisionArrows = createElement("span", { class: "dtools" }, [arrows[0], arrows[1], pairLabel, arrows[2], arrows[3]]);
  const baseSide = createElement("span", { class: "dside" }, [createElement("span", { class: "dside-name", text: "Base commit" }), createElement("span", { class: "dside-arrows" }, [arrows[0], arrows[1]])]);
  const targetSide = createElement("span", { class: "dside" }, [createElement("span", { class: "dside-name", text: "Target commit" }), createElement("span", { class: "dside-arrows" }, [arrows[2], arrows[3]])]);
  const revisionArrows = createElement("span", { class: "dtools" }, [baseSide, pairLabel, targetSide]);
  const summary = createElement("summary", { class: "dhead dfile-head" }, [namePlate, revisionArrows]);
  const modeButtons = [
    createElement("button", { "data-mode": DiffPaneMode.side, text: "diff side-by-side" }),
    createElement("button", { "data-mode": DiffPaneMode.inline, text: "diff inline" }),
  ];
  const fullToggle = createElement("input") as HTMLInputElement;
  fullToggle.type = "checkbox";
  const fullLabel = createElement("label", { class: "dfull-toggle" }, [fullToggle, " full content"]);
  const exportButton = createElement("button", { text: "export as patch" });
  const tools = createElement("div", { class: "dhead" }, [createElement("span", { class: "dtools" }, [...modeButtons, fullLabel, exportButton])]);
  // Born hidden: the pane reveals it only once a loaded pair actually differs.
  tools.style.display = "none";
  const meta = createElement("div", { class: "dmeta" });
  const body = createElement("div", { class: "dfile-body" });
  // The tools row stays OUT of the DOM for a lone revision: [hidden] loses to CSS display rules.
  details.append(...(config.revisionControlsShown ? [summary, tools, meta, body] : [summary, meta, body]));
  if (!config.revisionControlsShown) {
    for (const arrow of arrows) {
      arrow.hidden = true;
    }
  }
  const pane = createDiffPane({ pairLabel, meta, body, modeButtons, fullToggle, exportButton, arrows, toolsRow: tools },
    { mode: config.mode, fullContents: config.fullContents, onSidesChanged: config.onSidesChanged });
  void pane.showPair(path, steps, config.baseIndex, config.targetIndex);
  return details;
}

function blockClick(event: Event): void {
  event.preventDefault();
}

// `renderDetailView`: the drawer body is a dumb scrollable area — clear it, add the panes, done.
export function renderDetailView(panes: HTMLElement[]): void {
  getRequiredElementById("drawer").classList.add("open");
  getRequiredElementById("dmulti").hidden = panes.length < 2;
  // The drawer header already names a lone file; its section plate would say it again.
  if (panes.length === 1) {
    panes[0]!.querySelector(".dfile-path")?.remove();
    // A lone section never folds: its summary click is inert (the arrows keep their own handlers).
    panes[0]!.querySelector("summary")?.addEventListener("click", blockClick);
  }
  getRequiredElementById("dbody").replaceChildren(...panes);
  syncFoldAllLabel();
}

// The one fold button reads "Collapse all" while any section is open, "Show all" once every one is closed.
export function syncFoldAllLabel(): void {
  const sections = document.querySelectorAll<HTMLDetailsElement>("#dbody details.dfile");
  let anyOpen = false;
  for (const section of sections) {
    if (section.open) {
      anyOpen = true;
    }
  }
  getRequiredElementById("dfold-all").textContent = anyOpen ? "Collapse all" : "Show all";
}
