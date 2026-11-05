// Task L9 redo: the ruler's fixed head with the `session` button, rebuilt after every ruler redraw.

import { createElement, getRequiredElementById } from "./app-dom.ts";

const HEAD_ID = "ruler-head";
const TOGGLE_ID = "session-toggle";

export function removeRulerHead(): void {
  document.getElementById(HEAD_ID)?.remove();
}

export function renderRulerHead(isOn: boolean, onToggle: () => void): void {
  removeRulerHead();
  const button = createElement("button", { id: TOGGLE_ID, class: isOn ? "session-toggle current" : "session-toggle", text: "session" });
  button.onclick = onToggle;
  const head = createElement("div", { id: HEAD_ID, class: "ruler-head" }, [button]);
  getRequiredElementById("ruler").prepend(head);
}
