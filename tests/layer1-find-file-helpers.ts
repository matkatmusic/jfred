// Shared setup for the Layer 1 find box tests. happy-dom has no scrolling, so scrollIntoView is spied on.

import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE and would double each Enter. Absorb that boot here, on a throwaway DOM.
initLayer1Dom();
const { initLayer1Page } = await import("../webapp/layer1-page.ts");
export const { moveToBubbleAtPath, moveToNamedBubble } = await import("../webapp/layer1-find-file.ts");

// Full paths of the scrolled bubbles, in call order. Emptied in place by openFoundPage, never reassigned.
export const scrolledPaths: string[] = [];

// The options each of those calls carried (task 277: which EDGE of the bubble the scroll aligns).
export const scrolledOptions: ScrollIntoViewOptions[] = [];

// The spy sits on the prototype because each openFoundPage() call builds fresh bubbles that the page owns.
function installScrollIntoViewSpy(): void {
  HTMLElement.prototype.scrollIntoView = function recordScroll(this: HTMLElement, options?: unknown): void {
    scrolledPaths.push(this.querySelector<HTMLElement>(".fname")?.dataset.path ?? "");
    scrolledOptions.push((options ?? {}) as ScrollIntoViewOptions);
  };
}

// One bubble shaped like buildPairWidget output: basename as `.fname` text, full path in `data-path`.
function buildStageBubble(path: string): string {
  const basename = path.split("/").pop()!;
  return `<div class="filebox"><div class="fname" data-path="${path}">${basename}</div></div>`;
}

// A booted page whose stage holds `paths` as bubbles. Emptying the box clears cycle state, which outlives the DOM.
export function openFoundPage(paths: string[]): void {
  initLayer1Dom();
  initLayer1Page();
  installScrollIntoViewSpy();
  const box = document.getElementById("find-file") as HTMLInputElement;
  box.value = "";
  box.dispatchEvent(new window.Event("input", { bubbles: true }));
  scrolledPaths.length = 0;
  scrolledOptions.length = 0;
  let bubblesHtml = "";
  for (const path of paths)
    bubblesHtml += buildStageBubble(path);
  document.getElementById("stage")!.innerHTML = bubblesHtml;
}

export function readCrumbText(): string {
  return document.getElementById("crumb")!.textContent ?? "";
}

// Task 273: the find box's own readout, in the .sources row beside the box, not in the shared #crumb.
export function readFindStatusText(): string {
  return document.getElementById("find-status")!.textContent ?? "";
}

// Type `term` into the box and press Enter, the page's only submit — there is no Find button.
export function sendTermWithEnter(term: string): void {
  const box = document.getElementById("find-file") as HTMLInputElement;
  box.value = term;
  box.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

// Click one of task 271's cycle buttons by id.
export function dispatchCycleButtonClick(buttonId: string): void {
  document.getElementById(buttonId)!.dispatchEvent(new window.Event("click", { bubbles: true }));
}

// The six colliding bubbles the task names as the real case in this repo.
export const COLLIDING_PATHS = [
  ".claude/launch.json",
  ".vscode/launch.json",
  ".vscode-parent/launch.json",
  "tasks.json",
  ".vscode/tasks.json",
  ".vscode-parent/tasks.json",
];
