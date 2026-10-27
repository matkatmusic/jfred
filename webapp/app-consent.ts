// Script-execution consent dialog: running recorded scripts is opt-in, declining still yields a degraded document.

import { createElement } from "./app-dom.ts";
import { storeConsentChoice } from "./app-choices.ts";
import { type WireConsentScript } from "./app-fetch.ts";
import { ConsentBlockKind, groupConsentScriptsIntoBlocks } from "./app-consent-model.ts";
import { attachConsentNavigation } from "./app-consent-nav.ts";
import { appendReadOnlyScriptsBlock, buildConsentScriptRow, toggleReadOnlyBlocksVisibility } from "./app-consent-rows.ts";
import { attachToggleAllButton } from "./app-consent-toggle-all.ts";
import { renderRoute } from "./app-router.ts";

function countReadOnlyScripts(scripts: WireConsentScript[]): number {
  let readOnlyCount = 0;
  for (const script of scripts) {
    if (script.readOnly === true) {
      readOnlyCount++;
    }
  }
  return readOnlyCount;
}

function applyConsentChoice(project: string, choice: string): void {
  storeConsentChoice(project, choice);
  renderRoute();
}

// The choice is remembered per project for this browser session only.
export function renderConsentDialog(container: HTMLElement, project: string, scripts: WireConsentScript[]): void {
  const readOnlyCount = countReadOnlyScripts(scripts);
  const modifyingCount = scripts.length - readOnlyCount;
  const countSplit = readOnlyCount > 0 ? ` — ${modifyingCount} modifying, ${readOnlyCount} read-only` : "";
  const runButton = createElement("button", { class: "toolbar-btn consent-run", text: "Run scripts for this reconstruction", onclick: () => applyConsentChoice(project, "1") }) as HTMLButtonElement;
  const continueButton = createElement("button", { class: "toolbar-btn", text: "Continue without running", onclick: () => applyConsentChoice(project, "0") }) as HTMLButtonElement;
  const jumpToTopButton = createElement("button", { class: "toolbar-btn consent-jump-top", text: "Jump to top", onclick: () => container.scrollTo({ top: 0, behavior: "smooth" }) }) as HTMLButtonElement;
  const prevButton = createElement("button", { class: "toolbar-btn", text: "< Prev" }) as HTMLButtonElement;
  const nextButton = createElement("button", { class: "toolbar-btn", text: "Next >" }) as HTMLButtonElement;
  const navCounter = createElement("span", { class: "muted consent-nav-counter" });
  const expandAllButton = createElement("button", { class: "toolbar-btn", text: "Expand All" }) as HTMLButtonElement;
  // Sticky so decisions and navigation stay reachable while previews scroll.
  const header = createElement("div", { class: "consent-header" }, [
    createElement("h2", { text: `This reconstruction contains ${scripts.length} recorded script execution(s)${countSplit}` }),
    createElement("div", { class: "consent-header-row" }, [
      runButton, continueButton, jumpToTopButton, prevButton, nextButton, navCounter, expandAllButton,
    ]),
  ]);
  const box = createElement("div", { class: "consent-box" }, [
    header,
    createElement("div", { class: "muted", text: "Re-running them reproduces script-made file states. Nothing runs without your say-so." }),
  ]);
  if (readOnlyCount > 0) {
    box.append(createElement("button", {
      class: "toolbar-btn",
      text: "Show/hide Read-only scripts",
      onclick: () => toggleReadOnlyBlocksVisibility(box),
    }));
  }
  for (const block of groupConsentScriptsIntoBlocks(scripts)) {
    if (block.kind === ConsentBlockKind.modifying) {
      box.append(buildConsentScriptRow(block.script));
    }
    else {
      appendReadOnlyScriptsBlock(box, block.scripts);
    }
  }
  attachConsentNavigation(box, scripts, { prevButton, nextButton, navCounter });
  attachToggleAllButton(box, expandAllButton);
  // Hide the skeleton button so two Expand All buttons never show at once; renderRoute un-hides it.
  (document.getElementById("toggle-all") as HTMLButtonElement).hidden = true;
  container.append(box);
}
