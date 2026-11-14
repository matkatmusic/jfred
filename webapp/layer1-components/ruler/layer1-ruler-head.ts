// Task L9 redo: the ruler's fixed head, an empty sticky strip, rebuilt after every ruler redraw.

import { createElement, getRequiredElementById } from "../../app-dom.ts";

const HEAD_ID = "ruler-head";
// step 27: the session button moved to show-row.html
// const TOGGLE_ID = "session-toggle";

export function removeRulerHead(): void {
  document.getElementById(HEAD_ID)?.remove();
}

export function renderRulerHead(): void {
  removeRulerHead();
  // const button = createElement("button", { id: TOGGLE_ID, class: isOn ? "session-toggle current" : "session-toggle", text: "session" });
  // button.onclick = onToggle;
  const head = createElement("div", { id: HEAD_ID, class: "ruler-head", "data-component": "rulerHeadBar" });
  getRequiredElementById("timelineRulerComponent").prepend(head);
}
