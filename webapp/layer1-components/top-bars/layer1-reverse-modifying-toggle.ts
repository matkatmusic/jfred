// The "Show only modifying events for File" checkbox dims the reverse nodes that did not change the file; it remembers nothing across reloads.

import { getRequiredElementById } from "../../app-dom.ts";

const DIM_NON_MODIFYING_CLASS = "reverse-modifying-only";

let modifyingOnlyOn = false;

export function isReverseModifyingOnlyOn(): boolean {
  return modifyingOnlyOn;
}

// Shown only while reverse mode is on: the caller that owns the reverse mode state calls this.
export function showReverseModifyingToggle(isShown: boolean): void {
  getRequiredElementById("reverse-modifying-only").hidden = !isShown;
}

function readReverseModifyingCheckbox(): HTMLInputElement {
  return getRequiredElementById("reverse-modifying-only").querySelector("input")!;
}

function applyReverseModifyingCheckbox(): void {
  modifyingOnlyOn = readReverseModifyingCheckbox().checked;
  document.querySelector(".appWindow")!.classList.toggle(DIM_NON_MODIFYING_CLASS, modifyingOnlyOn);
}

// function flipReverseModifyingToggle(): void {
//   modifyingOnlyOn = !modifyingOnlyOn;
//   getRequiredElementById("reverse-modifying-only").classList.toggle("current", modifyingOnlyOn);
//   document.querySelector(".appWindow")!.classList.toggle(DIM_NON_MODIFYING_CLASS, modifyingOnlyOn);
// }

export function installReverseModifyingToggle(): void {
  readReverseModifyingCheckbox().addEventListener("change", applyReverseModifyingCheckbox);
}
