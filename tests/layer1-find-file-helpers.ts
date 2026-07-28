// The shared harness for the Layer 1 find box's tests (task 261, extended by tasks 271/273/280).  Split out of tests/layer1-find-file.test.ts when tasks 271 and 273 pushed that file past the repo's 250-line cap: what moved here is only the SETUP — the DOM boot, the scroll spy, the bubble fixture and the two readouts — so every test and every one of its scenario comments stayed where it was.
//
// happy-dom implements NO layout and NO scrolling, so nothing here reads a scroll position — that would be measuring happy-dom rather than the page. Instead scrollIntoView is SPIED on: the contract under test is "the right element was asked to centre itself", which is exactly what the production code delegates to the browser.

import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// webapp/layer1-page.ts calls bootLayer1Page() at MODULE SCOPE, so the first import in this process wires every listener a SECOND time — and one Enter would then advance the cycle twice. Absorb that boot here, against a throwaway DOM (same guard as tests/layer1-zoom.test.ts).
setupLayer1Dom();
const { bootLayer1Page } = await import("../webapp/layer1-page.ts");
export const { jumpToBubbleAtPath, jumpToNamedBubble } = await import("../webapp/layer1-find-file.ts");

// What scrollIntoView was called on, in call order, named by the FULL path so a collision test can tell the six same-basename bubbles apart. Exported by reference and emptied in place by openFoundPage — never reassigned, so an importing test keeps seeing the same array.
export const scrolledPaths: string[] = [];

// The options each of those calls carried (task 277: which EDGE of the bubble the scroll aligns).
export const scrolledOptions: ScrollIntoViewOptions[] = [];

// The spy. Installed on the prototype rather than per element because the bubbles are built fresh by each openFoundPage() call, and the page — not the test — owns those elements.
function spyOnScrollIntoView(): void {
    HTMLElement.prototype.scrollIntoView = function recordScroll(this: HTMLElement, options?: unknown): void {
        scrolledPaths.push(this.querySelector<HTMLElement>(".fname")?.dataset.path ?? "");
        scrolledOptions.push((options ?? {}) as ScrollIntoViewOptions);
    };
}

// One bubble in the same shape buildPairWidget emits: the BASENAME as the visible `.fname` text (task 245) and the full path as that element's `data-path` (task 280 moved it off `title`). The box must match what the user can SEE, which is only the basename — so a test fixture that put the full path in the text would prove nothing.
function buildStageBubble(path: string): string {
    const basename = path.split("/").pop()!;
    return `<div class="filebox"><div class="fname" data-path="${path}">${basename}</div></div>`;
}

// A booted page whose stage holds `paths` as bubbles. A fresh DOM is NOT enough on its own: the cycle position and the term it belongs to are module scope, so they outlive the document — two tests searching the same term would otherwise have the second one resume where the first stopped.  Emptying the box is the page's OWN reset (task 273), so the leak is closed by driving that rather than by exporting a hook that exists only for the tests.
export function openFoundPage(paths: string[]): void {
    setupLayer1Dom();
    bootLayer1Page();
    spyOnScrollIntoView();
    const box = document.getElementById("find-file") as HTMLInputElement;
    box.value = "";
    box.dispatchEvent(new window.Event("input", { bubbles: true }));
    scrolledPaths.length = 0;
    scrolledOptions.length = 0;
    document.getElementById("stage")!.innerHTML = paths.map(buildStageBubble).join("");
}

export function readCrumbText(): string {
    return document.getElementById("crumb")!.textContent ?? "";
}

// Task 273: the find box's own readout, beside the box in the .sources row rather than in the header's shared #crumb — which is what makes clearing it one empty string rather than a save-and-replay of whatever the stage had written into the crumb.
export function readFindStatusText(): string {
    return document.getElementById("find-status")!.textContent ?? "";
}

// Type `term` into the box and press Enter, the page's only submit — there is no Find button.
export function submitTermWithEnter(term: string): void {
    const box = document.getElementById("find-file") as HTMLInputElement;
    box.value = term;
    box.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

// Click one of task 271's cycle buttons by id.
export function clickCycleButton(buttonId: string): void {
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
