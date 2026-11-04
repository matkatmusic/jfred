// Task 382: the show row's "hide ignored nodes" box; ON at build, outside the kind filter.

import { createElement } from "./app-dom.ts";

const HIDE_IGNORED_ATTRIBUTE = "data-hide-ignored";

function toggleHideIgnored(event: Event): void {
  // The kind filter listens on #show-row and treats every change as a kind box.
  event.stopPropagation();
  const box = event.target as HTMLInputElement;
  document.querySelector(".viz-root")!.toggleAttribute(HIDE_IGNORED_ATTRIBUTE, box.checked);
}

export function buildHideIgnoredControl(): HTMLElement {
  const box = createElement("input", { type: "checkbox", id: "hide-ignored", onchange: toggleHideIgnored }) as HTMLInputElement;
  box.checked = true;
  document.querySelector(".viz-root")!.setAttribute(HIDE_IGNORED_ATTRIBUTE, "");
  return createElement("label", { class: "show-kind show-ignored" }, [box, "hide ignored nodes"]);
}
