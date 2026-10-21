// Task 360: the show row's checkboxes hide node kinds by CSS attribute; no relayout, no refetch.

import { getInputById, getRequiredElementById } from "./app-dom.ts";
import { hasLoadedEdits, loadEditsOnce } from "./layer1-edits.ts";
import { getHiddenKindsForProject, saveHiddenKinds } from "./layer1-settings.ts";
import { ShowRowKind, renderShowRow } from "./layer1-show-row.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

export const KIND_HIDDEN_CLASS = "kind-hidden";

// The HIDDEN kinds, not the shown ones, so a kind that appears later defaults to visible.
let hiddenKinds = new Set<ShowRowKind>();

// Registered by layer1-tick-files.ts so the ruler follows the boxes without an import cycle.
let notifyKindFilterChange: () => void = () => {};

export function onKindFilterChange(callback: () => void): void {
    notifyKindFilterChange = callback;
}

// A label takes the class of the dot before it; created is checked before disk (nodes carry both).
export function classifyNodeKind(element: HTMLElement): ShowRowKind | undefined {
    const dot = element.matches(".nlabel") ? element.previousElementSibling : element;
    if (dot === null) {
        return undefined;
    }
    if (dot.matches(".n-created")) {
        return ShowRowKind.created;
    }
    if (dot.matches(".n-commit")) {
        return ShowRowKind.commit;
    }
    if (dot.matches(".n-disk")) {
        return ShowRowKind.disk;
    }
    if (dot.matches(".n-snap")) {
        return ShowRowKind.snapshot;
    }
    if (dot.matches(".n-edit, .n-read")) {
        return ShowRowKind.edit;
    }
    if (dot.matches(".n-script")) {
        return ShowRowKind.scriptRun;
    }
    return undefined;
}

export function isKindHidden(kind: ShowRowKind | undefined): boolean {
    return kind !== undefined && hiddenKinds.has(kind);
}

function applyHiddenKindsAttribute(): void {
    document.querySelector(".viz-root")!.setAttribute("data-hidden-kinds", [...hiddenKinds].join(" "));
}

// Task 343: the view and redraw the Edit box uses; each render sets them.
let drawnView: WireLayer1View | undefined;
let redrawStage: (() => void) | undefined;

async function handleKindToggle(event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const kind = Object.values(ShowRowKind).find((candidate) => candidate === box.dataset["kind"])!;
    if (kind === ShowRowKind.edit && box.checked && !hasLoadedEdits(drawnView!)) {
        const isLoaded = await loadEditsOnce(drawnView!);
        if (!isLoaded) {
            box.checked = false;
            return;
        }
        redrawStage!();
    }
    if (box.checked) {
        hiddenKinds.delete(kind);
    } else {
        hiddenKinds.add(kind);
    }
    applyHiddenKindsAttribute();
    // Edit starts hidden on every load, so it is never saved.
    saveHiddenKinds([...hiddenKinds].filter((hidden) => hidden !== ShowRowKind.edit));
    notifyKindFilterChange();
}

// The [3] button clicks the Edit box, so both share one code path.
function tickEditBox(): void {
    const box = document.querySelector<HTMLInputElement>(`#show-row input[data-kind="${ShowRowKind.edit}"]`)!;
    if (!box.checked) {
        box.click();
    }
}

export function renderShowRowWithKindFilter(view: WireLayer1View, redrawView: () => void): void {
    drawnView = view;
    redrawStage = redrawView;
    renderShowRow(view);
    const saved = getHiddenKindsForProject(getInputById("dir").value.trim());
    hiddenKinds = new Set(Object.values(ShowRowKind).filter((kind) => saved.includes(kind)));
    hiddenKinds.add(ShowRowKind.edit);
    for (const box of document.querySelectorAll<HTMLInputElement>("#show-row input[data-kind]")) {
        box.checked = !hiddenKinds.has(box.dataset["kind"] as ShowRowKind);
    }
    applyHiddenKindsAttribute();
    // Assigned, not added, so a re-render never stacks listeners.
    getRequiredElementById("show-row").onchange = handleKindToggle;
    getRequiredElementById("layer-3").onclick = tickEditBox;
}
