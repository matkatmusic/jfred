// Mounted inside #timeline-pane so the console, inspector, and header stay usable during a load.

import { el } from "./app-dom.ts";

let loadingProgressElements: {
    overlay: HTMLElement;
    phaseLabel: HTMLElement;
    elapsed: HTMLElement;
    phaseFill: HTMLElement;
    label: HTMLElement;
    stageTrack: HTMLElement;
    fill: HTMLElement;
    timerId: number;
} | null = null;
let loadingProgressStartMs = 0;
let loadingProgressCurrentPhase = 0;

// Ordered phases matched by label substring; an unmatched label keeps the last phase rather than regressing the bar.
export const LOAD_PHASES = [
    "Resolving transcripts",
    "Parsing records",
    "Checking script consent",
    "Building document",
    "Transferring document",
    "Rendering timeline",
] as const;
export const LOAD_PHASE_COUNT = LOAD_PHASES.length;

const LOAD_PHASE_MATCHERS: string[][] = [
    ["resolving transcript", "resolved "],
    ["reusing cached transcript records", ".jsonl:", "parsing records"],
    ["scanning parsed records", "consent", "no script-execution"],
    ["reusing cached document artifact", "reading sidecar", "constructing branches",
        "scanning branch tips", "replaying lineage", "reconstructing ", "script stage", "executing script run",
        "building pre-execution", "indexing change ids", "extracting conversation",
        "summarizing branches", "building step snapshots", "building line verdicts",
        "building document"],
    ["serializing document", "sending document", "parsing document"],
    ["rendering timeline", "building timeline", "preparing timeline"],
];

// The 1-based phase for a progress label, or undefined when no family matches.
export function classifyLoadPhase(label: string): number | undefined {
    const lowered = label.toLowerCase();
    for (let phaseIndex = 0; phaseIndex < LOAD_PHASE_MATCHERS.length; phaseIndex++) {
        if (LOAD_PHASE_MATCHERS[phaseIndex]!.some((needle) => lowered.includes(needle))) {
            return phaseIndex + 1;
        }
    }
    return undefined;
}

// In-DOM confirm row, not window.confirm; navigating to "#/" aborts the in-flight load.
function buildCancelControls(): HTMLElement[] {
    const cancelButton = el("button", { class: "toolbar-btn timeline-progress-cancel", text: "Cancel" });
    const confirmYesButton = el("button", { class: "toolbar-btn timeline-progress-confirm-yes", text: "Yes, cancel" });
    const confirmNoButton = el("button", { class: "toolbar-btn timeline-progress-confirm-no", text: "No" });
    const confirmRow = el("div", { class: "timeline-progress-confirm" }, [
        el("span", { text: "Cancel this reconstruction?" }),
        confirmYesButton,
        confirmNoButton,
    ]);
    confirmRow.hidden = true;
    cancelButton.addEventListener("click", () => {
        cancelButton.hidden = true;
        confirmRow.hidden = false;
    });
    confirmNoButton.addEventListener("click", () => {
        confirmRow.hidden = true;
        cancelButton.hidden = false;
    });
    confirmYesButton.addEventListener("click", () => {
        window.location.hash = "#/";
    });
    return [cancelButton, confirmRow];
}

function updateElapsedLabel(): void {
    if (loadingProgressElements !== null) {
        loadingProgressElements.elapsed.textContent = `${((Date.now() - loadingProgressStartMs) / 1000).toFixed(1)}s`;
    }
}

// A non-finite `fraction` shimmers instead of filling, so a silent multi-second stage never reads as frozen.
export function showLoadingProgress(label: string, fraction: number): void {
    if (loadingProgressElements === null) {
        const phaseLabel = el("div", { class: "timeline-progress-phase" });
        const elapsed = el("div", { class: "timeline-progress-elapsed" });
        const header = el("div", { class: "timeline-progress-header" }, [phaseLabel, elapsed]);
        const phaseFill = el("div", { class: "timeline-progress-fill" });
        const phaseTrack = el("div", { class: "timeline-progress-track" }, [phaseFill]);
        const stageLabel = el("div", { class: "timeline-progress-label" });
        const fill = el("div", { class: "timeline-progress-fill" });
        const stageTrack = el("div", { class: "timeline-progress-track" }, [fill]);
        const box = el("div", { class: "timeline-progress-box" }, [header, phaseTrack, stageLabel, stageTrack, ...buildCancelControls()]);
        const overlay = el("div", { class: "timeline-progress-overlay" }, [box]);
        loadingProgressStartMs = Date.now();
        loadingProgressCurrentPhase = 0;
        const timerId = window.setInterval(updateElapsedLabel, 100);
        loadingProgressElements = { overlay, phaseLabel, elapsed, phaseFill, label: stageLabel, stageTrack, fill, timerId };
    }
    const elements = loadingProgressElements;
    elements.label.textContent = label;
    const phase = classifyLoadPhase(label);
    if (phase !== undefined) {
        loadingProgressCurrentPhase = phase;
    }
    if (loadingProgressCurrentPhase > 0) {
        elements.phaseLabel.textContent = `${LOAD_PHASES[loadingProgressCurrentPhase - 1]} · phase ${loadingProgressCurrentPhase} of ${LOAD_PHASE_COUNT}`;
        elements.phaseFill.style.width = `${(loadingProgressCurrentPhase / LOAD_PHASE_COUNT) * 100}%`;
    }
    if (Number.isFinite(fraction)) {
        elements.stageTrack.classList.remove("indeterminate");
        elements.fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    } else {
        elements.stageTrack.classList.add("indeterminate");
    }
    if (!elements.overlay.isConnected) {
        // task 164: pane-scoped — the console and inspector stay interactive during a load.
        (document.getElementById("timeline-pane") ?? document.body).append(elements.overlay);
    }
}

export function hideLoadingProgress(): void {
    if (loadingProgressElements !== null) {
        window.clearInterval(loadingProgressElements.timerId);
        loadingProgressElements.overlay.remove();
        loadingProgressElements = null;
    }
}
