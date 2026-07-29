// Task 257.4: the Detail View drawer's file body — a line-number column beside the file's text.
//
// The numbered-row layout came from `appendInlineDiff` in webapp/views/details-diff.ts; it is a copy rather than an import because anything under webapp/views/ drags app-routes.ts → inspector.ts → timeline-*.ts — the entire classic app — into a page that today loads only layer1-*.js, the same call layer1-sources.ts already made about the folder picker.
//
// Task 294: the text itself is coloured by webapp/highlight.ts's renderCodeInto, the SAME wrapper the classic Revision View uses. The numbers are a separate column rather than a per-line prefix so the highlighter is handed the WHOLE file in one call — a block comment or a template literal spanning lines is tokenised once, which per-line highlighting cannot do.

import { el } from "./app-dom.ts";
import { renderCodeInto } from "./highlight.ts";

// How much of the head of a file is enough to tell text from bytes. A binary file's first kilobyte effectively always carries a NUL or an undecodable byte; a text file's never does.
const BINARY_SNIFF_LENGTH = 1024;
// The route reads every file as UTF-8, so a byte that is not valid UTF-8 arrives as U+FFFD. One stray replacement character is legitimate in real text, a tenth of the sample is not.
const BINARY_REPLACEMENT_SHARE = 0.1;

// Is this the decoded text of a file, or the wreckage of a binary one read as UTF-8?
export function looksBinary(content: string): boolean {
    const head = content.slice(0, BINARY_SNIFF_LENGTH);
    if (head.includes("\u0000")) {
        return true;
    }
    const replacements = head.length - head.replaceAll("\ufffd", "").length;
    return head.length > 0 && replacements / head.length > BINARY_REPLACEMENT_SHARE;
}

// Fill `host` (the drawer's #dbody) with `content`, numbered and syntax-highlighted for `path`.
export function renderFileContentInto(host: HTMLElement, content: string, path: string): void {
    // A PNG rendered as numbered lines is thousands of rows of mojibake that say nothing about the file and take a visible moment to lay out (user, 2026-07-27). Say what it is instead; showing the image itself is task 299.
    if (looksBinary(content)) {
        host.replaceChildren(el("div", { class: "dbinary", text: "Binary file — not shown as text." }));
        return;
    }
    const lines = content.split("\n");
    // A file's trailing newline would otherwise number an empty last row that is not in the file.
    if (lines.length > 1 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    // Both columns inherit #dbody's monospace font, line-height and `white-space: pre`, which is what keeps the numbers level with the rows they count.
    const gutter = el("div", { class: "dgutter", text: lines.map((_line, index) => index + 1).join("\n") });
    const code = el("code", { class: "dcode" });
    renderCodeInto(code, lines.join("\n"), path);
    host.replaceChildren(gutter, code);
}
