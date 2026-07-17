// App shell entry: splitter wiring + the browser bootstrap. The pieces this file used to hold
// live in their own modules now — el() (app-dom.ts), routes (app-routes.ts), the loading console
// (app-console.ts), the progress overlay (app-progress.ts), fetch/caches/consent storage
// (app-fetch.ts), the consent dialog (app-consent-model.ts/app-consent.ts), the sub-route drawer
// (app-drawer.ts), and the route/header dispatch (app-router.ts).

import { collapseProgressConsole, ensureProgressTerminal, expandProgressConsole } from "./app-console.ts";
import { inflightLoadController } from "./app-fetch.ts";
import { initializeHeader } from "./app-header.ts";
import { renderRoute } from "./app-router.ts";

// Item 10a: dead code, commented out — a hidden inspector is display:none on EVERY route
// (styles.css has no .inspector-pane.hidden rail override), so this handler could never fire.
// Collapse/expand is now the inspector's own » / « toggle button (inspector.js).
// function handleInspectorRailClick(event) {
//     const pane = event.currentTarget;
//     if (event.target !== pane) {
//         return;
//     }
//     if (!pane.classList.contains("hidden")) {
//         return;
//     }
//     pane.classList.remove("hidden");
// }

// ─── splitters (item 66, ported from the mockup) ─────────────────────────────

// Dragging the splitter pins the pane's flex-basis to its pointer-tracked pixel size
// (invert=true for a pane sitting AFTER its splitter, e.g. the console row).
function makeSplitter(splitterId: string, paneId: string, axis: "x" | "y", invert: boolean, minPx: number): void {
    const splitter = document.getElementById(splitterId)!;
    const pane = document.getElementById(paneId)!;
    let startPos = 0;
    let startSize = 0;
    splitter.addEventListener("pointerdown", (event) => {
        startPos = axis === "y" ? event.clientY : event.clientX;
        const rect = pane.getBoundingClientRect();
        startSize = axis === "y" ? rect.height : rect.width;
        splitter.setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    splitter.addEventListener("pointermove", (event) => {
        if (!splitter.hasPointerCapture(event.pointerId)) {
            return;
        }
        const pos = axis === "y" ? event.clientY : event.clientX;
        let delta = pos - startPos;
        if (invert) {
            delta = -delta;
        }
        const size = Math.max(minPx, startSize + delta);
        pane.style.flexGrow = "0";
        pane.style.flexShrink = "0";
        pane.style.flexBasis = `${size}px`;
    });
    splitter.addEventListener("pointerup", (event) => {
        splitter.releasePointerCapture(event.pointerId);
    });
}

// Bootstrap only in a real browser: the node test suite imports the view modules (for their
// DOM-free view-model functions), which transitively loads this module without a window.
if (typeof window !== "undefined") {
    ensureProgressTerminal();   // show the empty 10-row console immediately, before any load
    window.addEventListener("hashchange", renderRoute);
    // Item 10a: rail-click reopen retired with handleInspectorRailClick above.
    // document.getElementById("inspector").addEventListener("click", handleInspectorRailClick);
    // item 66: fork-layout chrome — the three splitters + the console hide/show pair.
    makeSplitter("split-td", "timeline-pane", "y", false, 80);
    makeSplitter("split-lr", "details-left", "x", false, 140);
    makeSplitter("split-dc", "console-row", "y", true, 60);
    document.getElementById("console-hide")!.addEventListener("click", collapseProgressConsole);
    document.getElementById("console-show")!.addEventListener("click", expandProgressConsole);
    document.getElementById("console-cancel")!.addEventListener("click", () => {
        (document.getElementById("console-cancel") as HTMLButtonElement).disabled = true; // re-enabled by setCancelButtonVisible when the cancel lands
        inflightLoadController?.abort();
    });
    initializeHeader().then(renderRoute);
}
