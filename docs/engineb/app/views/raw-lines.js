// Raw-lines view (#/project/<name>/jsonl/<file>/lines): the transcript's numbered lines with
// the legacy filter modes (Show All / File Only / Edits Only) plus a substring filter.
// Clicking a line opens the JSON inspector.
import { el as elUntyped } from "../app-dom.js";
import { fetchDocument, fetchRawRecords } from "../app-fetch.js";
import { renderConsentDialog } from "../app-consent.js";
import { renderBaselineQuestionDialog } from "../app-baseline-question.js";
import { openTranscriptInspector } from "../inspector.js";
import { findLineForChangeId } from "./file-history-model.js";
const el = elUntyped;
// Pure filter over the document's per-line verdicts. mode: "all" | "file" (verdict marks file
// relevance, i.e. not "ignore") | "edits" (the line carries a revision's changeId — the plan's
// steps[].changeIds are re-stamped uuids that rarely match raw lines, so the changeId scan is
// the honest edit set).
export function buildRawLinesViewModel(document, rawLines, mode, substring) {
    const editLines = new Set();
    for (const history of document.filesTouched) {
        for (const revision of history.revisions) {
            const line = findLineForChangeId(rawLines, revision.changeId);
            if (line >= 0)
                editLines.add(line);
        }
    }
    const lowered = substring.toLowerCase();
    const entries = [];
    for (const verdict of document.lineVerdicts) {
        if (mode === "file" && verdict.verdict === "ignore")
            continue;
        if (mode === "edits" && !editLines.has(verdict.line))
            continue;
        const text = rawLines[verdict.line] ?? "";
        if (lowered !== "" && !text.toLowerCase().includes(lowered))
            continue;
        entries.push({ line: verdict.line, verdict: verdict.verdict, text });
    }
    return { entries };
}
function appendRawLineRow(listPane, entry, inspectLine) {
    listPane.append(el("div", {
        class: "raw-line",
        "data-line": String(entry.line),
        onclick: () => inspectLine(entry.line),
    }, [
        el("span", { class: "raw-line-num", text: String(entry.line) }),
        el("span", { class: "raw-line-verdict", text: entry.verdict }),
        el("span", { class: "raw-line-text", text: entry.text }),
    ]));
}
export async function renderRawLinesView(container, project, jsonl) {
    const result = await fetchDocument(project, jsonl);
    if (result.baselineQuestion !== undefined) {
        renderBaselineQuestionDialog(container, project, result.baselineQuestion);
        return;
    }
    if (result.consentRequired !== undefined) {
        renderConsentDialog(container, project, result.consentRequired);
        return;
    }
    const documentJson = result.document;
    const rawLines = await fetchRawRecords(project, jsonl);
    // Inspector navigation scrolls the visible row list in step (a filtered-out line just
    // has no row to highlight).
    const highlightLine = (line) => {
        const row = listPane.querySelector(`[data-line="${line}"]`);
        if (row === null)
            return;
        listPane.querySelectorAll(".anchored").forEach((old) => old.classList.remove("anchored"));
        row.classList.add("anchored");
        row.scrollIntoView({ block: "center" });
    };
    const inspectLine = (line) => openTranscriptInspector({ jsonlName: jsonl, rawLines, line, onJumpToLine: highlightLine });
    const modeSelect = el("select", {}, [
        el("option", { value: "all", text: "Show All" }),
        el("option", { value: "file", text: "File Only" }),
        el("option", { value: "edits", text: "Edits Only" }),
    ]);
    const substringInput = el("input", { type: "text", placeholder: "substring filter…", spellcheck: "false" });
    const countLabel = el("span", { class: "muted" });
    const listPane = el("div");
    const renderList = () => {
        const viewModel = buildRawLinesViewModel(documentJson, rawLines, modeSelect.value, substringInput.value);
        countLabel.textContent = `${viewModel.entries.length} / ${rawLines.length} lines`;
        listPane.replaceChildren();
        for (const entry of viewModel.entries) {
            appendRawLineRow(listPane, entry, inspectLine);
        }
    };
    modeSelect.addEventListener("change", renderList);
    substringInput.addEventListener("input", renderList);
    container.append(el("div", { class: "filter-bar" }, [
        el("div", { class: "pane-title", text: `${jsonl} · raw lines` }),
        modeSelect,
        substringInput,
        countLabel,
    ]));
    container.append(listPane);
    renderList();
}
