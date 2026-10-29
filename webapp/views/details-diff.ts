// Details pane right-column rendering (task 92): pane plumbing plus text/content/diff renders sharing the shownDiff toggle state.

import { createElement } from "../app-dom.ts";
import { getBaselineChoice, getConsentChoice } from "../app-choices.ts";
import { fetchText } from "../app-fetch.ts";
import { resetDetailsFind } from "./details-find.ts";
import { appendColumnsDiff, appendInlineDiff } from "../diff-render.ts";
import { splitDiffBlocks } from "./file-history-diff-blocks.ts";
import {
  type DiffToggleLabel,
  convertStoredDiffModeToToggle,
  isFullContentsOn,
  readStoredDiffMode,
  writeStoredDiffMode,
  writeStoredFullContents,
} from "./details-stored-choices.ts";
import { renderCodeInto } from "../highlight.ts";

// ── shared right-pane plumbing ──────────────────────────────────────────────────────────────

export function setDetailsHeader(text: string): void {
  document.getElementById("details-header")!.textContent = text;
}

export function setRightPaneLabel(text: string): void {
  document.getElementById("details-right-label")!.textContent = text;
}

export function hideDiffModeToggle(): void {
  document.getElementById("diff-mode-toggle")!.hidden = true;
}

export function clearRightPaneBody(): HTMLElement {
  // Every right-pane render routes through here, so stale find-widget Ranges never survive a re-render (task 127).
  resetDetailsFind();
  const body = document.getElementById("details-right-body")!;
  body.replaceChildren();
  return body;
}

// The shown diff, kept for toggle re-renders; `reload` re-fetches since full-context is a different response (item 75).
let shownDiff: { label: string; path: string; diffText: string; reload: () => void; unrecoverableReason?: string } | undefined;

// Plain explanatory text in the right pane (rename-only revisions, missing blocks).
export function renderTextInDetails(label: string, text: string): void {
  shownDiff = undefined;
  setRightPaneLabel(label);
  hideDiffModeToggle();
  clearRightPaneBody().append(createElement("pre", { class: "diff-text", text }));
}

// The revision's full content in the right pane, syntax-highlighted (file-mode "Show content").
export function renderContentInDetails(target: string, revisionNumber: number, content: string | undefined): void {
  shownDiff = undefined;
  setRightPaneLabel(`${target} — revision #${revisionNumber} content`);
  hideDiffModeToggle();
  const pane = createElement("pre", { class: "inspector-text" });
  if (content === undefined) {
    pane.textContent = "(no step snapshot carries this file yet)";
  }
  else {
    renderCodeInto(pane, content, target);
  }
  clearRightPaneBody().append(pane);
}

// task 126: the placeholder's banner stack: ⚠ banner, carried-forward note, previous-revision section title.
function appendUnrecoverableBanner(body: HTMLElement, reason: string): void {
  body.append(
    createElement("div", { class: "recon-banner" }, [
      createElement("span", { class: "warn", text: "⚠ Not reconstructed" }),
      ` — ${reason}`,
    ]),
    createElement("pre", { class: "diff-text", text: "(the previous revision's content is carried forward at this revision)" }),
    createElement("div", { class: "pane-title", text: "— previous revision content —" }),
  );
}

// task 126: ⚠ banner then the previous revision's diff; the reason rides shownDiff so toggles keep the banner.
export function renderUnrecoverableInDetails(label: string, path: string, reason: string, previousDiffText: string | undefined, reload: () => void): void {
  if (previousDiffText === undefined) {
    shownDiff = undefined;
    setRightPaneLabel(label);
    hideDiffModeToggle();
    const body = clearRightPaneBody();
    appendUnrecoverableBanner(body, reason);
    body.append(createElement("pre", { class: "diff-text", text: "(no previous revision to show — this is the first revision)" }));
    return;
  }
  renderDiffInDetails(label, path, previousDiffText, reload, reason);
}

// One diff in the persisted toggle's layout; #dm-columns / #dm-inline re-render the SAME diff.
export function renderDiffInDetails(label: string, path: string, diffText: string, reload: () => void, unrecoverableReason?: string): void {
  shownDiff = { label, path, diffText, reload, unrecoverableReason };
  setRightPaneLabel(label);
  const mode = convertStoredDiffModeToToggle(readStoredDiffMode());
  const toggle = document.getElementById("diff-mode-toggle")!;
  toggle.hidden = false;
  const fullButton = document.getElementById("dm-full")!;
  const columnsButton = document.getElementById("dm-columns")!;
  const inlineButton = document.getElementById("dm-inline")!;
  fullButton.classList.toggle("active", isFullContentsOn());
  columnsButton.classList.toggle("active", mode === "columns");
  inlineButton.classList.toggle("active", mode === "inline");
  const applyDiffMode = (label2: DiffToggleLabel) => {
    writeStoredDiffMode(label2);
    if (shownDiff !== undefined) {
      renderDiffInDetails(shownDiff.label, shownDiff.path, shownDiff.diffText, shownDiff.reload, shownDiff.unrecoverableReason);
    }
  };
    // Full contents widens git context, so it re-fetches via reload rather than re-rendering.
  fullButton.onclick = () => {
    writeStoredFullContents(!isFullContentsOn());
    reload();
  };
  columnsButton.onclick = () => applyDiffMode("columns");
  inlineButton.onclick = () => applyDiffMode("inline");
  const body = clearRightPaneBody();
  if (unrecoverableReason !== undefined) {
    appendUnrecoverableBanner(body, unrecoverableReason);
  }
  if (mode === "columns") {
    appendColumnsDiff(body, diffText, path);
    return;
  }
  appendInlineDiff(body, diffText, path);
}

// The revision-timeline diff blocks of one file, freshly fetched with the file-history view's /api/diff request.
export async function fetchRevisionDiffBlocks(project: string, target: string, fullContents: boolean): Promise<string[]> {
  const params = new URLSearchParams({ project, file: target, mode: "revisions" });
  const consentChoice = getConsentChoice(project);
  if (consentChoice === "1") {
    params.set("allowScripts", "1");
  }
  const baselineChoice = getBaselineChoice(project);   // task 56: same cached document
  if (baselineChoice !== null)
    params.set("preBaseline", baselineChoice);
  if (fullContents) {
    params.set("context", "full");
  }
  return splitDiffBlocks(await fetchText(`/api/diff?${params}`));
}
