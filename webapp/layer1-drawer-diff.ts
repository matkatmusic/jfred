// Task 305/329: shared revision-step helpers; the shift-click range gesture lives in layer1-drawer-multi.ts.

import { getRequiredElementById } from "./app-dom.ts";
import { type DiffStep } from "./layer1-diff-pane.ts";
import { clearDiffWash } from "./layer1-diff-wash.ts";
import { describeCommitStep, describeDiskStep, describeSnapshotStep } from "./layer1-revision-sources.ts";

// A commit node carries its full hash on the dot's `title`; anything else diffs as the working tree.
export function nodeCommitHash(node: HTMLElement): string | undefined {
    return node.classList.contains("n-commit") && node.title !== "" ? node.title : undefined;
}

// Any lane node as a revision source: commit blob, session snapshot, or the on-disk state.
export function describeNodeStep(node: HTMLElement, path: string): DiffStep {
    const hash = nodeCommitHash(node);
    if (hash !== undefined) {
        return describeCommitStep(path, hash);
    }
    if (node.classList.contains("n-snap")) {
        return describeSnapshotStep(path, {
            sessionFile: node.dataset.sessionFile ?? "",
            sessionId: node.dataset.sessionId ?? "",
            version: Number(node.dataset.version ?? 0),
        });
    }
    return describeDiskStep(path);
}

// Task 329 retired the drawer's fixed pair rows; only the image strip remains header chrome.
export function setDrawerTools(tools: "img" | "none"): void {
    getRequiredElementById("imgtools").hidden = tools !== "img";
}

export function clearDiffPair(): void {
    clearDiffWash();
    for (const marked of document.querySelectorAll(".diff-base, .diff-target")) {
        marked.classList.remove("diff-base", "diff-target");
    }
}
