// Task 329: THE diff pane — the single-pair drawer and every multi-file section share this one controller.

import { el, getRequiredElementById } from "./app-dom.ts";
import { appendColumnsDiff, appendInlineDiff } from "./diff-render.ts";

const TOAST_MILLISECONDS = 2600;

export const DiffPaneMode = Object.freeze({ side: "side", inline: "inline" } as const);
export type DiffPaneModeValue = (typeof DiffPaneMode)[keyof typeof DiffPaneMode];

// One diffable revision: a marker plus its fully-computed file state AS A STRING; any source works.
export type DiffStep = {
    marker: string;
    // The /api/layer1-file query behind loadContent, exposed so an image section can fetch bytes.
    buildParams: () => URLSearchParams;
    loadContent: () => Promise<string>;
};

// The pane's mounted elements: the drawer passes its fixed-id rows, a multi section its own.
export type DiffPaneMounts = {
    pairLabel: HTMLElement;
    meta: HTMLElement;
    body: HTMLElement;
    modeButtons: HTMLElement[];
    fullToggle: HTMLInputElement;
    exportButton: HTMLElement;
    // The whole mode/full/export row, hidden while equal sides show one revision instead of a diff.
    toolsRow?: HTMLElement;
    // base ↑, base ↓, target ↑, target ↓ — older is up, matching the lane's axis.
    arrows: [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
};

export type DiffPaneOptions = {
    mode: DiffPaneModeValue;
    fullContents: boolean;
    onSidesChanged?: (baseIndex: number, targetIndex: number) => void;
};

export type DiffPane = {
    showPair(path: string, steps: DiffStep[], baseIndex: number, targetIndex: number): Promise<void>;
    clear(): void;
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;

// The refusal is VISIBLE, never a silent no-op (task 305). One #dtoast serves every pane.
export function flashToast(text: string): void {
    const toast = getRequiredElementById("dtoast");
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, TOAST_MILLISECONDS);
}

export function createDiffPane(mounts: DiffPaneMounts, options: DiffPaneOptions): DiffPane {
    let mode = options.mode;
    let fullContents = options.fullContents;
    let shown: { path: string; steps: DiffStep[]; baseIndex: number; targetIndex: number } | undefined;
    let diffText = "";
    // Same STRING on both sides — same revision picked twice, or no change between revisions.
    let identicalSides = false;

    function paintControls(): void {
        for (const button of mounts.modeButtons) {
            button.classList.toggle("current", button.dataset.mode === mode);
        }
        mounts.fullToggle.checked = fullContents;
        if (shown === undefined) {
            return;
        }
        // Identical sides ARE the whole file: full content is forced on and the toggle locked.
        mounts.fullToggle.checked = fullContents || identicalSides;
        mounts.fullToggle.disabled = identicalSides;
        // Identical sides are not a diff: the tools row vanishes until the contents differ.
        if (mounts.toolsRow !== undefined) {
            mounts.toolsRow.style.display = identicalSides ? "none" : "";
        }
        const indices = [shown.baseIndex, shown.targetIndex] as const;
        mounts.arrows.forEach((arrow, at) => {
            const landing = indices[at < 2 ? 0 : 1]! + (at % 2 === 0 ? -1 : 1);
            arrow.disabled = landing < 0 || landing > shown!.steps.length - 1;
        });
    }

    function renderBody(): void {
        if (shown === undefined) {
            return;
        }
        paintControls();
        if (diffText === "") {
            mounts.body.replaceChildren(el("div", { class: "dbinary", text: "No text differences between these revisions." }));
            return;
        }
        mounts.body.replaceChildren();
        (mode === DiffPaneMode.inline ? appendInlineDiff : appendColumnsDiff)(mounts.body, diffText, shown.path);
    }

    // diff = buildDiffFrom(base, target): both sides resolve to strings, the pure route diffs them.
    async function loadDiffText(): Promise<boolean> {
        const { steps, baseIndex, targetIndex } = shown!;
        mounts.body.textContent = "loading…";
        try {
            const [base, target] = await Promise.all([steps[baseIndex]!.loadContent(), steps[targetIndex]!.loadContent()]);
            identicalSides = base === target;
            const response = await fetch("/api/layer1-diff-content", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ base, target, context: fullContents || identicalSides ? "full" : undefined }),
            });
            if (!response.ok) {
                mounts.body.textContent = await response.text();
                return false;
            }
            diffText = (await response.json() as { diff: string }).diff;
            return true;
        } catch (error) {
            mounts.body.textContent = String(error);
            return false;
        }
    }

    async function showPair(path: string, steps: DiffStep[], baseIndex: number, targetIndex: number): Promise<void> {
        shown = { path, steps, baseIndex, targetIndex };
        // Equal sides ARE one revision (a full-content view), so the label says it once.
        mounts.pairLabel.textContent = baseIndex === targetIndex
            ? steps[targetIndex]!.marker
            : `${steps[baseIndex]!.marker} - ${steps[targetIndex]!.marker}`;
        // No path (the name plate has it); equal sides say nothing — the pair label already names the revision.
        mounts.meta.textContent = baseIndex === targetIndex
            ? ""
            : `base ${steps[baseIndex]!.marker} → target ${steps[targetIndex]!.marker}`;
        paintControls();
        options.onSidesChanged?.(baseIndex, targetIndex);
        if (await loadDiffText()) {
            renderBody();
        }
    }

    // "export as patch": headers + hunks make one git-apply-able file patch (task 218's shape).
    function exportPatch(): void {
        if (shown === undefined || diffText === "") {
            flashToast("no differences to export");
            return;
        }
        const path = shown.path;
        const patch = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${diffText}\n`;
        const link = el("a") as HTMLAnchorElement;
        link.href = URL.createObjectURL(new Blob([patch], { type: "text/x-patch" }));
        link.download = `${path.split("/").pop()}.patch`;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    // Wired once per pane. preventDefault: inside a <summary>, the default click would fold the section.
    for (const button of mounts.modeButtons) {
        button.addEventListener("click", (event) => {
            event.preventDefault();
            mode = button.dataset.mode as DiffPaneModeValue;
            renderBody();
        });
    }
    // Task 320: full content is a context-width toggle — the diff stays shown, refetched wider/narrower.
    mounts.fullToggle.addEventListener("change", () => {
        fullContents = mounts.fullToggle.checked;
        if (shown === undefined) {
            return;
        }
        void loadDiffText().then((loaded) => {
            if (loaded) {
                renderBody();
            }
        });
    });
    mounts.arrows.forEach((arrow, at) => {
        arrow.addEventListener("click", (event) => {
            event.preventDefault();
            if (shown === undefined || arrow.disabled) {
                return;
            }
            const side = at < 2 ? "baseIndex" : "targetIndex";
            shown[side] += at % 2 === 0 ? -1 : 1;
            void showPair(shown.path, shown.steps, shown.baseIndex, shown.targetIndex);
        });
    });
    mounts.exportButton.addEventListener("click", (event) => {
        event.preventDefault();
        exportPatch();
    });

    return { showPair, clear: () => { shown = undefined; } };
}
