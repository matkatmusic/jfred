// The text of a file at one instant, colored by token and split into numbered display lines for the View File box.

import assert from "node:assert/strict";
import { basename } from "node:path";
import type { Element, RootContent } from "hast";
import { common, createLowlight } from "lowlight";
import { Path } from "../../src/structures/domain.ts";
import { TUI_COLORS } from "./engineV3_tui_colors.ts";
import { getInverseCommitAtInstant } from "../engineV3_inverse_repo_read.ts";
import { getInverseRepoFolderForFile } from "../engineV3_inverse_repos_for_project.ts";

// color undefined: the box draws the piece in its text color.
export type ColoredPiece = { text: string; color: string | undefined };
export type FileViewLine = { lineNumber: number | undefined; pieces: ColoredPiece[] };

// export const HIGHLIGHT_COLOR_BY_TOKEN_CLASS: Record<string, string> = {
//     "hljs-keyword": "magenta",
//     "hljs-string": "green",
//     "hljs-comment": "gray",
//     "hljs-number": "yellow",
//     "hljs-literal": "yellow",
//     "hljs-title": "blue",
//     "hljs-built_in": "cyan",
//     "hljs-type": "cyan",
//     "hljs-attr": "cyan",
// };
export const HIGHLIGHT_COLOR_BY_TOKEN_CLASS: Record<string, string> = TUI_COLORS.fileViewBox.tokenColors;

const lowlight = createLowlight(common);

// undefined: no state is stored at the instant, or the file is absent at the instant.
export function readFileTextAtInstant(storeFolder: Path, projectFolder: Path, file: Path, instant: Date): string | undefined {
    const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, file);
    const commit = getInverseCommitAtInstant(repoFolder, basename(file.toString()), instant);
    return commit?.text;
}

function findTokenColor(element: Element): string | undefined {
    const classNames = (element.properties.className ?? []) as string[];
    for (const className of classNames) {
        const color = HIGHLIGHT_COLOR_BY_TOKEN_CLASS[className];
        if (color !== undefined) {
            return color;
        }
    }
    return undefined;
}

function collectPieces(node: RootContent, inheritedColor: string | undefined, fileLines: ColoredPiece[][]): void {
    if (node.type === "text") {
        for (const [index, part] of node.value.split(/\r?\n/).entries()) {
            if (index > 0) {
                fileLines.push([]);
            }
            if (part !== "") {
                fileLines[fileLines.length - 1]!.push({ text: part, color: inheritedColor });
            }
        }
    }
    if (node.type === "element") {
        const color = findTokenColor(node) ?? inheritedColor;
        for (const child of node.children) {
            collectPieces(child, color, fileLines);
        }
    }
}

// One list of pieces for each file line. A language that is undefined gives plain pieces; a language lowlight does not know throws.
export function highlightFileLines(text: string, language: string | undefined): ColoredPiece[][] {
    const fileLines: ColoredPiece[][] = [[]];
    if (language === undefined) {
        collectPieces({ type: "text", value: text }, undefined, fileLines);
    }
    if (language !== undefined) {
        for (const node of lowlight.highlight(language, text).children) {
            collectPieces(node, undefined, fileLines);
        }
    }
    if (text.endsWith("\n")) {
        fileLines.pop();
    }
    return fileLines;
}

// A file line longer than contentWidth becomes several display lines; only the first holds the line number.
export function buildFileViewLines(fileLines: ColoredPiece[][], contentWidth: number): FileViewLine[] {
    assert.ok(contentWidth > 0, `contentWidth must be above 0, got ${contentWidth}`);
    const displayLines: FileViewLine[] = [];
    for (const [index, fileLine] of fileLines.entries()) {
        let row: ColoredPiece[] = [];
        let rowWidth = 0;
        displayLines.push({ lineNumber: index + 1, pieces: row });
        for (const piece of fileLine) {
            for (let start = 0; start < piece.text.length;) {
                if (rowWidth === contentWidth) {
                    row = [];
                    rowWidth = 0;
                    displayLines.push({ lineNumber: undefined, pieces: row });
                }
                const chunk = piece.text.slice(start, start + contentWidth - rowWidth);
                row.push({ text: chunk, color: piece.color });
                rowWidth += chunk.length;
                start += chunk.length;
            }
        }
    }
    return displayLines;
}

export function clampFileViewScrollTop(scrollTop: number, lineCount: number, visibleLineCount: number): number {
    return Math.max(0, Math.min(scrollTop, lineCount - visibleLineCount));
}
