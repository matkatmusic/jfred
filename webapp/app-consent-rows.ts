// Consent dialog script rows and read-only blocks: building them and flipping their expanded state.

import { createElement } from "./app-dom.ts";
import { type WireConsentScript } from "./app-fetch.ts";
import {
  checkConsentScriptOverflowsPreview,
  CONSENT_SCRIPT_LANGUAGE_PATH,
  formatConsentSourceToken,
  splitInlineInterpreterCode,
} from "./app-consent-model.ts";
import { renderCodeInto } from "./highlight.ts";

// Shell lines carrying inline code (`python3 -c "…"`) highlight only the quoted body, in the interpreter's language.
export function buildConsentScriptRow(script: WireConsentScript): HTMLElement {
  const pre = createElement("pre");
  const inline = splitInlineInterpreterCode(script.code);
  if (inline === undefined) {
    renderCodeInto(pre, script.code, CONSENT_SCRIPT_LANGUAGE_PATH);
  }
  else {
    const bodySpan = createElement("span");
    renderCodeInto(bodySpan, inline.body, inline.languagePath);
    pre.append(document.createTextNode(inline.prefix), bodySpan, document.createTextNode(inline.suffix));
  }
  const row = createElement("div", { class: "consent-script" }, [
    createElement("div", { class: "muted", text: new Date(script.timestamp).toLocaleString() + (script.cwd ? `  ·  cwd ${script.cwd}` : "") + formatConsentSourceToken(script.source) }),
    pre,
  ]);
  const overflowsPreview = checkConsentScriptOverflowsPreview(script.code);
  if (overflowsPreview) {
    const expandButton = createElement("button", { class: "toolbar-btn", text: "Expand" });
    expandButton.onclick = () => {
      const nowExpanded = pre.classList.toggle("expanded");
      expandButton.textContent = nowExpanded ? "Collapse" : "Expand";
    };
    row.append(expandButton);
  }
  return row;
}

export function listReadOnlyBlocks(box: HTMLElement): HTMLDetailsElement[] {
  return [...box.querySelectorAll<HTMLDetailsElement>("details.consent-readonly-block")];
}

export function isAnyBlockClosed(blocks: HTMLDetailsElement[]): boolean {
  for (const block of blocks) {
    if (!block.open) {
      return true;
    }
  }
  return false;
}

// Shares the per-block <details> state the triangles use: any block closed means open all.
export function toggleReadOnlyBlocksVisibility(box: HTMLElement): void {
  const detailsBlocks = listReadOnlyBlocks(box);
  const shouldOpen = isAnyBlockClosed(detailsBlocks);
  for (const block of detailsBlocks)
    block.open = shouldOpen;
}

export function appendReadOnlyScriptsBlock(box: HTMLElement, scripts: WireConsentScript[]): void {
  const firstTimestamp = new Date(scripts[0]!.timestamp).toLocaleString();
  const rows: HTMLElement[] = [];
  for (const script of scripts) {
    rows.push(buildConsentScriptRow(script));
  }
  box.append(createElement("details", { class: "consent-readonly-block" }, [
    createElement("summary", { class: "muted", text: `----- ${firstTimestamp} ${scripts.length} readonly script(s) -----` }),
    ...rows,
  ]));
}

export function updateRowExpandButtonLabel(pre: HTMLPreElement, shouldExpand: boolean): void {
  const row = pre.parentElement;
  if (row !== null) {
    const rowButton = row.querySelector("button");
    if (rowButton !== null) {
      rowButton.textContent = shouldExpand ? "Collapse" : "Expand";
    }
  }
}
