// App shell entry: splitter wiring and the browser bootstrap; the other pieces live in their own app-*.ts modules.

import { closeProgressConsole, initProgressTerminal, openProgressConsole } from "./app-console.ts";
import { initHeader } from "./app-header.ts";
import { initProjectPathsSection } from "./app-paths-project.ts";
import { initializeWizard, maybeStartFirstLaunchWizard } from "./app-paths-wizard.ts";
import { renderRoute } from "./app-router.ts";
import { initDetailsFind } from "./views/details-find.ts";

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

// Dragging pins the pane's flex-basis to its pointer size; invert=true for a pane AFTER its splitter.
function initSplitter(splitterId: string, paneId: string, axis: "x" | "y", invert: boolean, minPx: number): void {
  const splitter = document.getElementById(splitterId)!;
  const pane = document.getElementById(paneId)!;
  let startPos = 0;
  let startSize = 0;
  function openSplitterDrag(event: PointerEvent): void {
    startPos = axis === "y" ? event.clientY : event.clientX;
    const rect = pane.getBoundingClientRect();
    startSize = axis === "y" ? rect.height : rect.width;
    splitter.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function moveSplitterDrag(event: PointerEvent): void {
    const hasCapture = splitter.hasPointerCapture(event.pointerId);
    if (!hasCapture) {
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
  }
  function closeSplitterDrag(event: PointerEvent): void {
    splitter.releasePointerCapture(event.pointerId);
  }
  splitter.addEventListener("pointerdown", openSplitterDrag);
  splitter.addEventListener("pointermove", moveSplitterDrag);
  splitter.addEventListener("pointerup", closeSplitterDrag);
}

function initRoutingAfterHeader(): void {
  initProjectPathsSection();                     // task 137: the popover's per-project section
  initializeWizard();                            // task 159: the Paths wizard state machine
  maybeStartFirstLaunchWizard();                 // task 159: no global config → full wizard
  renderRoute();
}

// Bootstrap only in a real browser: node tests import this module transitively, without a window.
if (typeof window !== "undefined") {
  initProgressTerminal();   // show the empty 10-row console immediately, before any load
  window.addEventListener("hashchange", renderRoute);
  // Item 10a: rail-click reopen retired with handleInspectorRailClick above.
  // document.getElementById("inspector").addEventListener("click", handleInspectorRailClick);
  // item 66: fork-layout chrome — the three splitters + the console hide/show pair.
  initSplitter("split-sd", "drawer", "x", false, 140);
  initSplitter("split-td", "timeline-pane", "y", false, 80);
  initSplitter("split-lr", "details-left", "x", false, 140);
  initSplitter("split-dc", "console-row", "y", true, 60);
  initDetailsFind();          // task 127: the right pane's find widget (input + n/N + < >)
  document.getElementById("console-hide")!.addEventListener("click", closeProgressConsole);
  document.getElementById("console-show")!.addEventListener("click", openProgressConsole);
  // task 164: #console-cancel retired; the progress box's Cancel navigates to "#/", aborting the load.
  initHeader().then(initRoutingAfterHeader);
}
