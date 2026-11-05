// Builds the Layer 1 page from its shell html by swapping each include line for the named part file.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// `<!-- include <part path> -->` alone on its lines; the html hook may split it over three lines.
const INCLUDE_LINE = /^[ \t]*<!--\s*include (\S+)\s*-->$/gm;

// Each part replaces its include line, minus one trailing newline, so line breaks stay unchanged.
function joinHtmlIncludes(html: string, baseDir: string): string {
  let joinedHtml = "";
  let copiedUpTo = 0;
  for (const includeMatch of html.matchAll(INCLUDE_LINE)) {
    const [includeLine, partPath] = includeMatch as unknown as [string, string];
    const partHtml = readFileSync(resolve(baseDir, partPath), "utf8");
    const joinedPart = joinHtmlIncludes(partHtml, baseDir);
    joinedHtml += html.slice(copiedUpTo, includeMatch.index) + joinedPart.replace(/\n$/, "");
    copiedUpTo = includeMatch.index + includeLine.length;
  }
  return joinedHtml + html.slice(copiedUpTo);
}

// Include paths at every level resolve against the shell's folder; a missing part file throws.
export function joinLayer1Page(shellPath: string): string {
  const shellHtml = readFileSync(shellPath, "utf8");
  return joinHtmlIncludes(shellHtml, dirname(shellPath));
}
