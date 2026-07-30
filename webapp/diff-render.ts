// Task 305: diff renderers shared by the details pane and Layer 1 drawer; imports no webapp/views/ code.

import { el } from "./app-dom.ts";
import { SplitRowKind, computeInlineRows, computeSplitRows } from "./diff-vs-base-model.ts";
import { computeLanguageForPath } from "./highlight.ts";

// Colour one cell's code through the vendored hljs global; plain text without it (renderCodeInto's guard).
function renderCellCode(cell: HTMLElement, code: string, language: string | undefined): void {
    if (language === undefined || typeof hljs === "undefined" || hljs.getLanguage(language) === undefined) {
        cell.textContent = code;
        return;
    }
    // hljs HTML-escapes the source text itself, so this is not an injection surface.
    cell.innerHTML = hljs.highlight(code, { language, ignoreIllegals: true }).value;
}

// An inline row keeps its raw ± marker as plain text; only the code after it gains tokens.
function appendMarkedCode(cell: HTMLElement, text: string, language: string | undefined): void {
    const marker = text !== "" && "+- ".includes(text[0]!) ? text[0]! : "";
    const code = el("span");
    renderCellCode(code, text.slice(marker.length), language);
    cell.append(marker, code);
}

// One .diff-line per unified line, gutter number + raw text; dels number the old side, hunk headers show ⋯.
export function appendInlineDiff(body: HTMLElement, diffText: string, path: string): void {
    const language = computeLanguageForPath(path);
    const pane = el("div", { class: "diff" });
    for (const row of computeInlineRows(diffText)) {
        const line = el("div", { class: "diff-line" });
        let lineNumberText: number | undefined;
        if (row.lineClass === "diff-line-hunk") {
            line.classList.add("hunk");
        } else if (row.lineClass === "diff-line-add") {
            line.classList.add("add");
            lineNumberText = row.newLineNumber;
        } else if (row.lineClass === "diff-line-del") {
            line.classList.add("del");
            lineNumberText = row.oldLineNumber;
        } else {
            lineNumberText = row.newLineNumber;
        }
        const gutterText = row.lineClass === "diff-line-hunk" ? "⋯" : lineNumberText === undefined ? "" : String(lineNumberText);
        const lineBody = el("span", { class: "diff-body" });
        if (row.lineClass === "diff-line-hunk") {
            lineBody.textContent = row.text;
        } else {
            appendMarkedCode(lineBody, row.text, language);
        }
        line.append(el("span", { class: "diff-ln", text: gutterText }), lineBody);
        pane.append(line);
    }
    body.append(pane);
}

// A split cell's class: dc-del / dc-add / plain context.
function mapSplitCellClass(lineClass: string): string {
    if (lineClass === "diff-line-del") {
        return "dc-del";
    }
    if (lineClass === "diff-line-add") {
        return "dc-add";
    }
    return "";
}

// One side's ln+body cell pair in the two-column grid; empty cells keep alignment.
function appendSplitCellPair(grid: HTMLElement, cell: { lineClass: string; lineNumber?: number; text: string } | undefined, side: number, language: string | undefined): void {
    const sideClass = side === 1 ? " dc-right" : "";
    if (cell === undefined) {
        grid.append(
            el("span", { class: `dc-ln${sideClass}` }),
            el("span", { class: "dc-body" }),
        );
        return;
    }
    const cellClass = mapSplitCellClass(cell.lineClass);
    const cellBody = el("span", { class: `dc-body ${cellClass}`.trim() });
    // Task 319: every split cell leads with its +/-/space marker, kept outside the highlighted code.
    const sign = cellClass === "dc-del" ? "-" : cellClass === "dc-add" ? "+" : " ";
    appendMarkedCode(cellBody, sign + cell.text, language);
    grid.append(
        el("span", { class: `dc-ln${sideClass} ${cellClass}`.trim(), text: cell.lineNumber === undefined ? "" : String(cell.lineNumber) }),
        cellBody,
    );
}

// The two-column diff grid; full rows span it as hunk headers, pair rows emit ln+body cells per side.
export function appendColumnsDiff(body: HTMLElement, diffText: string, path: string): void {
    const language = computeLanguageForPath(path);
    const grid = el("div", { class: "diff-cols" });
    for (const row of computeSplitRows(diffText)) {
        if (row.kind === SplitRowKind.full) {
            grid.append(el("span", { class: "dc-hunk", text: row.text }));
            continue;
        }
        [row.left, row.right].forEach((cell, side) => {
            appendSplitCellPair(grid, cell, side, language);
        });
    }
    body.append(grid);
}
