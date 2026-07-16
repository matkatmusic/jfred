// ─── centered loading-progress overlay ───────────────────────────────────────
// One reusable centered bar shown during the two long phases of opening a project: the server-side
// reconstruction stream (driven by fetchDocument's determinate progress lines) and the client-side
// timeline row build (item 78, driven from views/timeline.ts). Created once, appended on demand.

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

// The ordered phases the loading indicator advances through. Labels are matched by substring
// against the real server/client progress vocabulary (item 82). An unmatched label returns
// undefined so the caller keeps the last known phase rather than regressing the bar.
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
        "replaying lineage", "reconstructing ", "script stage", "executing script run",
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

// Show or update the always-visible loading indicator: a phase header (name · phase N of M) with a
// ticking elapsed clock, a phase bar, the current stage label, and a stage bar. A finite `fraction`
// fills the stage bar determinately; a non-finite one (a countless/blocking stage) shimmers instead,
// so even a silent multi-second step (67 MB stringify/parse) never reads as frozen (item 82).
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
        const box = el("div", { class: "timeline-progress-box" }, [header, phaseTrack, stageLabel, stageTrack]);
        const overlay = el("div", { class: "timeline-progress-overlay" }, [box]);
        loadingProgressStartMs = Date.now();
        loadingProgressCurrentPhase = 0;
        const timerId = window.setInterval(() => {
            if (loadingProgressElements !== null) {
                loadingProgressElements.elapsed.textContent = `${((Date.now() - loadingProgressStartMs) / 1000).toFixed(1)}s`;
            }
        }, 100);
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
        document.body.append(elements.overlay);
    }
}

export function hideLoadingProgress(): void {
    if (loadingProgressElements !== null) {
        window.clearInterval(loadingProgressElements.timerId);
        loadingProgressElements.overlay.remove();
        loadingProgressElements = null;
    }
}
