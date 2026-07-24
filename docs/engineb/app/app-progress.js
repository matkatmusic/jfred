// ─── centered loading-progress overlay ───────────────────────────────────────
// One reusable centered bar shown during the two long phases of opening a project: the server-side
// reconstruction stream (driven by fetchDocument's determinate progress lines) and the client-side
// timeline row build (item 78, driven from views/timeline.ts). Created once, appended on demand.
// task 164: mounted INSIDE #timeline-pane (not document.body) so only the timeline is blocked —
// the console, inspector, and header stay usable while a project loads.
import { el } from "./app-dom.js";
let loadingProgressElements = null;
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
];
export const LOAD_PHASE_COUNT = LOAD_PHASES.length;
const LOAD_PHASE_MATCHERS = [
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
export function classifyLoadPhase(label) {
    const lowered = label.toLowerCase();
    for (let phaseIndex = 0; phaseIndex < LOAD_PHASE_MATCHERS.length; phaseIndex++) {
        if (LOAD_PHASE_MATCHERS[phaseIndex].some((needle) => lowered.includes(needle))) {
            return phaseIndex + 1;
        }
    }
    return undefined;
}
// task 164: the box's cancel affordance — Cancel swaps to an in-DOM confirm row (never
// window.confirm: native dialogs block headless automation, app-header.ts convention).
// "Yes, cancel" navigates to the project picker: the overlay only exists during a
// project-route load, so assigning "#/" always fires hashchange -> renderRoute, which
// aborts the in-flight load (app-router.ts) — navigation IS the cancellation, one code path.
function buildCancelControls() {
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
function updateElapsedLabel() {
    if (loadingProgressElements !== null) {
        loadingProgressElements.elapsed.textContent = `${((Date.now() - loadingProgressStartMs) / 1000).toFixed(1)}s`;
    }
}
// Show or update the always-visible loading indicator: a phase header (name · phase N of M) with a
// ticking elapsed clock, a phase bar, the current stage label, and a stage bar. A finite `fraction`
// fills the stage bar determinately; a non-finite one (a countless/blocking stage) shimmers instead,
// so even a silent multi-second step (67 MB stringify/parse) never reads as frozen (item 82).
export function showLoadingProgress(label, fraction) {
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
    }
    else {
        elements.stageTrack.classList.add("indeterminate");
    }
    if (!elements.overlay.isConnected) {
        // task 164: pane-scoped — the console and inspector stay interactive during a load.
        (document.getElementById("timeline-pane") ?? document.body).append(elements.overlay);
    }
}
export function hideLoadingProgress() {
    if (loadingProgressElements !== null) {
        window.clearInterval(loadingProgressElements.timerId);
        loadingProgressElements.overlay.remove();
        loadingProgressElements = null;
    }
}
