// Raw-lines view (#/project/<name>/jsonl/<file>/lines): numbered transcript lines with mode and substring filters; a click opens the JSON inspector.

import { createElement as createElementUntyped } from "../app-dom.ts";
import { fetchDocument, fetchRawRecords } from "../app-fetch.ts";
import { renderConsentDialog } from "../app-consent.ts";
import { renderBaselineQuestionDialog } from "../app-baseline-question.ts";
import { openTranscriptInspector } from "../inspector.ts";
import { findLineForChangeId } from "./file-history-model.ts";

// Wire shapes for the /api/document pieces this view reads; ids and dates arrive as plain strings.
type WireRevision = { changeId: string };
type WireFileHistory = { revisions: WireRevision[] };
type WireLineVerdict = { line: number; verdict: string };
type WireDocument = { filesTouched: WireFileHistory[]; lineVerdicts: WireLineVerdict[] };
type RawLineEntry = { line: number; verdict: string; text: string };

// Typed view of the DOM builder: its untyped `children = []` default infers never[], rejecting every child.
type ElAttributes = Record<string, string | ((event: Event) => void)>;
const createElement = createElementUntyped as <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: ElAttributes,
  children?: HTMLElement[],
) => HTMLElementTagNameMap[K];

// Pure filter over per-line verdicts: mode all, file (verdict not ignore) or edits (line carries a revision changeId).
export function buildRawLinesViewModel(
  document: WireDocument,
  rawLines: string[],
  mode: string,
  substring: string,
): { entries: RawLineEntry[] } {
  const editLines = new Set<number>();
  for (const history of document.filesTouched) {
    for (const revision of history.revisions) {
      const line = findLineForChangeId(rawLines, revision.changeId);
      if (line >= 0)
        editLines.add(line);
    }
  }
  const lowered = substring.toLowerCase();
  const entries: RawLineEntry[] = [];
  for (const verdict of document.lineVerdicts) {
    const isFileMode = mode === "file";
    const isIgnored = verdict.verdict === "ignore";
    const isSkippedByFileMode = isFileMode && isIgnored;
    if (isSkippedByFileMode)
      continue;
    const isEditsMode = mode === "edits";
    const isEditLine = editLines.has(verdict.line);
    const isSkippedByEditsMode = isEditsMode && !isEditLine;
    if (isSkippedByEditsMode)
      continue;
    const text = rawLines[verdict.line] ?? "";
    const hasSubstring = lowered !== "";
    const textMatches = text.toLowerCase().includes(lowered);
    const isSkippedBySubstring = hasSubstring && !textMatches;
    if (isSkippedBySubstring)
      continue;
    entries.push({ line: verdict.line, verdict: verdict.verdict, text });
  }
  return { entries };
}

function appendRawLineRow(listPane: HTMLElement, entry: RawLineEntry, inspectLine: (line: number) => void): void {
  listPane.append(createElement("div", {
    class: "raw-line",
    "data-line": String(entry.line),
    onclick: () => inspectLine(entry.line),
  }, [
    createElement("span", { class: "raw-line-num", text: String(entry.line) }),
    createElement("span", { class: "raw-line-verdict", text: entry.verdict }),
    createElement("span", { class: "raw-line-text", text: entry.text }),
  ]));
}

export async function renderRawLinesView(container: HTMLElement, project: string, jsonl: string): Promise<void> {
  const result = await fetchDocument<WireDocument>(project, jsonl);
  if (result.baselineQuestion !== undefined) {
    renderBaselineQuestionDialog(container, project, result.baselineQuestion);
    return;
  }
  if (result.consentRequired !== undefined) {
    renderConsentDialog(container, project, result.consentRequired);
    return;
  }
  const documentJson = result.document!;
  const rawLines = await fetchRawRecords(project, jsonl);

  // Inspector navigation scrolls the visible row list in step (a filtered-out line just has no row to highlight).
  const markLineAnchored = (line: number): void => {
    const row = listPane.querySelector(`[data-line="${line}"]`);
    if (row === null)
      return;
    for (const old of listPane.querySelectorAll(".anchored"))
      old.classList.remove("anchored");
    row.classList.add("anchored");
    row.scrollIntoView({ block: "center" });
  };
  const openLineInspector = (line: number): void => openTranscriptInspector({ jsonlName: jsonl, rawLines, line, onJumpToLine: markLineAnchored });

  const modeSelect = createElement("select", {}, [
    createElement("option", { value: "all", text: "Show All" }),
    createElement("option", { value: "file", text: "File Only" }),
    createElement("option", { value: "edits", text: "Edits Only" }),
  ]);
  const substringInput = createElement("input", { type: "text", placeholder: "substring filter…", spellcheck: "false" });
  const countLabel = createElement("span", { class: "muted" });
  const listPane = createElement("div");

  const renderList = () => {
    const viewModel = buildRawLinesViewModel(documentJson, rawLines, modeSelect.value, substringInput.value);
    countLabel.textContent = `${viewModel.entries.length} / ${rawLines.length} lines`;
    listPane.replaceChildren();
    for (const entry of viewModel.entries) {
      appendRawLineRow(listPane, entry, openLineInspector);
    }
  };
  modeSelect.addEventListener("change", renderList);
  substringInput.addEventListener("input", renderList);

  container.append(createElement("div", { class: "filter-bar" }, [
    createElement("div", { class: "pane-title", text: `${jsonl} · raw lines` }),
    modeSelect,
    substringInput,
    countLabel,
  ]));
  container.append(listPane);
  renderList();
}

