// Task 257.4: the Detail View drawer's file body — one row per line, line number + line text.
//
// COPIED, not imported, from `appendInlineDiff` in webapp/views/details-diff.ts (the numbered-row
// half of the classic Revision View, reached from webapp/views/details-revision-view.ts). It is a
// copy because importing anything under webapp/views/ drags app-routes.ts → inspector.ts →
// timeline-*.ts — the entire classic app — into a page that today loads only layer1-*.js, the same
// call layer1-sources.ts already made about the folder picker.
//
// Only the numbered-lines rendering came across: the diff halves of details-diff.ts, and its
// hljs-highlighted `showContentInDetails`, are deliberately NOT copied — a drawer showing one file
// at one instant has nothing to diff against, and layer1.html loads no vendored highlight.js.

import { el } from "./app-dom.ts";

// Fill `host` (the drawer's #dbody) with `content` as numbered rows.
export function renderFileContentInto(host: HTMLElement, content: string): void {
    const lines = content.split("\n");
    // A file's trailing newline would otherwise number an empty last row that is not in the file.
    if (lines.length > 1 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    const gutterWidth = String(lines.length).length;
    host.replaceChildren(...lines.map((line, index) => el("div", { class: "dline" }, [
        // Padded numbers and `white-space: pre` inline: the gutter stays aligned and the code keeps
        // its indentation in a monospace #dbody even before .dline/.dln/.dcode carry any CSS.
        el("span", { class: "dln", style: "white-space: pre", text: `${String(index + 1).padStart(gutterWidth)}  ` }),
        el("span", { class: "dcode", style: "white-space: pre", text: line }),
    ])));
}
