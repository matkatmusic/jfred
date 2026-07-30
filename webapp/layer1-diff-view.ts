// Task 329: THE DiffView — one self-contained pane per file, used by node clicks, pairs, and nav selections.

import { el, getRequiredElementById } from "./app-dom.ts";
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

function basenameOf(path: string): string {
    return path.split("/").pop() ?? path;
}

function buildArrowButton(glyph: "↑" | "↓", side: string): HTMLButtonElement {
    const direction = glyph === "↑" ? "previous" : "next";
    return el("button", { text: glyph, title: `${direction} ${side} revision` }) as HTMLButtonElement;
}

// The single-pair drawer's three header rows (dhead/dpair/dfull-toggle/dmeta classes) plus the body.
export function buildDiffView(path: string, steps: DiffStep[], config: DiffViewConfig): HTMLElement {
    const details = el("details", { class: "dfile", open: "" });
    const namePlate = el("div", { class: "dpath dfile-path", text: basenameOf(path), title: path, "data-target": path });
    if (steps.length === 0) {
        details.append(el("summary", { class: "dhead dfile-head" }, [namePlate]),
            el("div", { class: "dbinary", text: config.emptyText ?? "Deleted — no on-disk state to show." }));
        return details;
    }
    // An image section shows the target revision as a picture — the text-diff pipeline never sees it.
    if (isImagePath(path)) {
        const params = steps[config.targetIndex]!.buildParams();
        params.set("binary", "1");
        const imageBody = el("div", { class: "dfile-body" });
        renderImageInto(imageBody, `/api/layer1-file?${params}`);
        details.append(el("summary", { class: "dhead dfile-head" }, [namePlate]), imageBody);
        return details;
    }
    const arrows: [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement, HTMLButtonElement] = [
        buildArrowButton("↑", "base"), buildArrowButton("↓", "base"),
        buildArrowButton("↑", "target"), buildArrowButton("↓", "target"),
    ];
    const pairLabel = el("span", { class: "dpair" });
    const revisionArrows = el("span", { class: "dtools" }, [arrows[0], arrows[1], pairLabel, arrows[2], arrows[3]]);
    const summary = el("summary", { class: "dhead dfile-head" }, [namePlate, revisionArrows]);
    const modeButtons = [
        el("button", { "data-mode": DiffPaneMode.side, text: "diff side-by-side" }),
        el("button", { "data-mode": DiffPaneMode.inline, text: "diff inline" }),
    ];
    const fullToggle = el("input") as HTMLInputElement;
    fullToggle.type = "checkbox";
    const fullLabel = el("label", { class: "dfull-toggle" }, [fullToggle, " full content"]);
    const exportButton = el("button", { text: "export as patch" });
    const tools = el("div", { class: "dhead" }, [el("span", { class: "dtools" }, [...modeButtons, fullLabel, exportButton])]);
    // Born hidden: the pane reveals it only once a loaded pair actually differs.
    tools.style.display = "none";
    const meta = el("div", { class: "dmeta" });
    const body = el("div", { class: "dfile-body" });
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

// `displayDetailView`: the drawer body is a dumb scrollable area — clear it, add the panes, done.
export function displayDetailView(panes: HTMLElement[]): void {
    getRequiredElementById("drawer").classList.add("open");
    getRequiredElementById("dmulti").hidden = panes.length < 2;
    // The drawer header already names a lone file; its section plate would say it again.
    if (panes.length === 1) {
        panes[0]!.querySelector(".dfile-path")?.remove();
        // A lone section never folds: its summary click is inert (the arrows keep their own handlers).
        panes[0]!.querySelector("summary")?.addEventListener("click", (event) => event.preventDefault());
    }
    getRequiredElementById("dbody").replaceChildren(...panes);
}
