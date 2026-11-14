// Task 382: the show row's "hide ignored nodes" box; ON at build, outside the kind filter.

import { createElement } from "../../app-dom.ts";

const HIDE_IGNORED_ATTRIBUTE = "data-hide-ignored";

function toggleHideIgnored(event: Event): void {
  // The kind filter listens on #timelineViewControls and treats every change as a kind box.
  event.stopPropagation();
  const box = event.target as HTMLInputElement;
  document.querySelector(".appWindow")!.toggleAttribute(HIDE_IGNORED_ATTRIBUTE, box.checked);
}

export function buildHideIgnoredControl(): HTMLElement {
  const box = createElement("input", { type: "checkbox", id: "hide-ignored", onchange: toggleHideIgnored, "data-component": "viewControlsHideIgnoredCheckbox" }) as HTMLInputElement;
  box.checked = true;
  document.querySelector(".appWindow")!.setAttribute(HIDE_IGNORED_ATTRIBUTE, "");
  return createElement("label", { class: "show-kind show-ignored", "data-component": "viewControlsHideIgnoredLabel" }, [box, "hide ignored nodes"]);
}
