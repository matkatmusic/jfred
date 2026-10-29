// Detail View drawer file body: a line-number column beside the highlighted file text.

import { createElement } from "./app-dom.ts";
import { renderCodeInto } from "./highlight.ts";

// The first kilobyte of a file is enough to tell text from binary.
const BINARY_SNIFF_LENGTH = 1024;
// One stray replacement character is normal in text; a tenth of the sample is not.
const BINARY_REPLACEMENT_SHARE = 0.1;

// Is this the decoded text of a file, or the wreckage of a binary one read as UTF-8?
export function isBinaryContent(content: string): boolean {
  const head = content.slice(0, BINARY_SNIFF_LENGTH);
  const hasNul = head.includes("\u0000");
  if (hasNul) {
    return true;
  }
  const replacements = head.length - head.replaceAll("\ufffd", "").length;
  return head.length > 0 && replacements / head.length > BINARY_REPLACEMENT_SHARE;
}

// Fill `host` (the drawer's #dbody) with `content`, numbered and syntax-highlighted for `path`.
export function renderFileContentInto(host: HTMLElement, content: string, path: string): void {
  // Numbered rows of binary garbage are useless and slow, so show a notice instead.
  const isBinary = isBinaryContent(content);
  if (isBinary) {
    host.replaceChildren(createElement("div", { class: "dbinary", text: "Binary file — not shown as text." }));
    return;
  }
  const lines = content.split("\n");
  // A file's trailing newline would otherwise number an empty last row that is not in the file.
  const hasMultipleLines = lines.length > 1;
  const endsWithEmptyLine = lines[lines.length - 1] === "";
  const hasTrailingNewline = hasMultipleLines && endsWithEmptyLine;
  if (hasTrailingNewline) {
    lines.pop();
  }
  // Both columns inherit #dbody's font and line-height, which keeps numbers level with rows.
  const lineNumbers: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    lineNumbers.push(index + 1);
  }
  const gutter = createElement("div", { class: "dgutter", text: lineNumbers.join("\n") });
  const code = createElement("code", { class: "dcode" });
  renderCodeInto(code, lines.join("\n"), path);
  host.replaceChildren(gutter, code);
}
